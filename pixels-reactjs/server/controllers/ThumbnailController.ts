import { Request, Response } from 'express'
import mongoose from 'mongoose';
import Thumbnail from '../models/Thumbnail.js';
import User from '../models/User.js';
import path from 'path';
import os from 'os';
import fs from 'fs';
import axios from 'axios';
import {v2 as cloudinary} from 'cloudinary'

const stylePrompts = {
    'Bold & Graphic': 'eye-catching thumbnail, bold typography, vibrant colors, expressive facial reaction, dramatic lighting, high contrast, click-worthy composition, professional style',
    'Tech/Futuristic': 'futuristic thumbnail, sleek modern design, digital UI elements, glowing accents, holographic effects, cyber-tech aesthetic, sharp lighting, high-tech atmosphere',
    'Minimalist': 'minimalist thumbnail, clean layout, simple shapes, limited color palette, plenty of negative space, modern flat design, clear focal point',
    'Photorealistic': 'photorealistic thumbnail, ultra-realistic lighting, natural skin tones, candid moment, DSLR-style photography, lifestyle realism, shallow depth of field',
    'Illustrated': 'illustrated thumbnail, custom digital illustration, stylized characters, bold outlines, vibrant colors, creative cartoon or vector art style',
}

const colorSchemeDescriptions = {
    vibrant: 'vibrant and energetic colors, high saturation, bold contrasts, eye-catching palette',
    sunset: 'warm sunset tones, orange pink and purple hues, soft gradients, cinematic glow',
    forest: 'natural green tones, earthy colors, calm and organic palette, fresh atmosphere',
    neon: 'neon glow effects, electric blues and pinks, cyberpunk lighting, high contrast glow',
    purple: 'purple-dominant color palette, magenta and violet tones, modern and stylish mood',
    monochrome: 'black and white color scheme, high contrast, dramatic lighting, timeless aesthetic',
    ocean: 'cool blue and teal tones, aquatic color palette, fresh and clean atmosphere',
    pastel: 'soft pastel colors, low saturation, gentle tones, calm and friendly aesthetic',
}

// Map aspect ratio to width/height for Pollinations
const dimensionsMap: Record<string, [number, number]> = {
    '16:9': [1024, 576],
    '9:16': [576, 1024],
    '1:1': [1024, 1024],
    '4:3': [1024, 768],
}

const getLegacyPublicId = (imageUrl?: string) => {
    if (!imageUrl) return null;

    try {
        const url = new URL(imageUrl);
        if (url.hostname !== 'res.cloudinary.com') return null;
        const match = url.pathname.match(/\/image\/upload\/(?:.*\/)?(final-output-\d+)(?:\.png)?$/);
        return match?.[1] ?? null;
    } catch {
        return null;
    }
}

export const generateThumbnail = async (req: Request, res: Response)=>{
    let thumbnail: any = null;
    let tempFilePath: string | null = null;
    let uploadedPublicId: string | null = null;
    let generationLock: {userId: string; until: Date} | null = null;
    try {
        const {userId} = req.session;
        if (!userId) {
            return res.status(401).json({message: 'You are not logged in'})
        }
        const { title, prompt: user_prompt, style, aspect_ratio, color_scheme, text_overlay } = req.body;

        if (
            typeof title !== 'string' || !title.trim() || title.trim().length > 100 ||
            typeof style !== 'string' || !Object.prototype.hasOwnProperty.call(stylePrompts, style) ||
            !['16:9', '1:1', '9:16'].includes(aspect_ratio) ||
            (color_scheme !== undefined && (typeof color_scheme !== 'string' || !Object.prototype.hasOwnProperty.call(colorSchemeDescriptions, color_scheme))) ||
            (user_prompt !== undefined && (typeof user_prompt !== 'string' || user_prompt.length > 500)) ||
            (text_overlay !== undefined && typeof text_overlay !== 'boolean')
        ) {
            return res.status(400).json({message: 'Invalid thumbnail options'})
        }
        const normalizedTitle = title.trim()

        const now = new Date();
        const lockUntil = new Date(now.getTime() + 3 * 60 * 1000);
        const lockedUser = await User.findOneAndUpdate(
            {
                _id: userId,
                $or: [
                    {generationLockUntil: {$exists: false}},
                    {generationLockUntil: {$lte: now}},
                ],
            },
            {$set: {generationLockUntil: lockUntil}},
            {new: true, select: '_id'}
        );
        if (!lockedUser) {
            return res.status(409).json({message: 'A thumbnail is already generating'})
        }
        generationLock = {userId, until: lockUntil};

        thumbnail = await Thumbnail.create({
            userId,
            title: normalizedTitle,
            prompt_used: user_prompt,
            user_prompt,
            style,
            aspect_ratio,
            color_scheme,
            text_overlay,
            isGenerating: true
        })

        let prompt = `Create a ${stylePrompts[style as keyof typeof stylePrompts]} for: "${normalizedTitle}".`

        if(color_scheme){
            prompt += ` Use a ${colorSchemeDescriptions[color_scheme as keyof typeof colorSchemeDescriptions]} color scheme.`
        }

        if(user_prompt){
            prompt += ` Additional details: ${user_prompt}.`
        }

        prompt += ` The thumbnail should be ${aspect_ratio}, visually stunning, and designed to maximize click-through rate. Make it bold, professional, and impossible to ignore.`

        // Generate image using Pollinations.ai (free, no API key required)
        const [width, height] = dimensionsMap[aspect_ratio] || [1024, 576];
        const encodedPrompt = encodeURIComponent(prompt);
        const seed = Math.floor(Math.random() * 1000000);
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true&seed=${seed}&referrer=thumblify`;

        let finalBuffer: Buffer | null = null;
        const maxRetries = 3;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const imageResponse = await axios.get(imageUrl, {
                    responseType: 'arraybuffer',
                    timeout: 30000
                });
                finalBuffer = Buffer.from(imageResponse.data);
                break;
            } catch (fetchError: any) {
                console.log(`Pollinations attempt ${attempt} failed:`, fetchError.message);
                if (attempt === maxRetries) throw fetchError;
                await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
            }
        }

        const filename = `final-output-${Date.now()}.png`;
        const filePath = path.join(os.tmpdir(), filename);
        tempFilePath = filePath;

        // Write the final image to the file 
        fs.writeFileSync(filePath, finalBuffer!);

        const uploadResult = await cloudinary.uploader.upload(filePath, {resource_type:'image'})
        uploadedPublicId = uploadResult.public_id;

        thumbnail.public_id = uploadedPublicId;
        thumbnail.image_url = text_overlay
            ? cloudinary.url(uploadResult.public_id, {
                secure: true,
                transformation: [
                    {
                        crop: 'fit',
                        width: Math.max(100, width - 80),
                        background: 'black',
                        color: 'white',
                        overlay: {font_family: 'Arial', font_size: 48, text: title},
                    },
                    {gravity: 'south', y: 40, flags: 'layer_apply'},
                ],
            })
            : uploadResult.secure_url;
        thumbnail.isGenerating = false;
        await thumbnail.save()

        res.json({message: 'Thumbnail Generated', thumbnail})

    } catch (error: any) {
        if (error.response) {
            // Axios error with a response from the server
            const rawData = error.response.data;
            const decodedData = Buffer.isBuffer(rawData) ? rawData.toString('utf-8') : rawData;
            console.log('Axios error status:', error.response.status);
            console.log('Axios error data:', decodedData);
        } else {
            console.log(error);
        }

        if (uploadedPublicId) {
            try {
                await cloudinary.uploader.destroy(uploadedPublicId, {resource_type: 'image'})
            } catch (cleanupError) {
                console.log('Failed to clean up uploaded thumbnail:', cleanupError)
            }
        }

        // Clean up the stuck thumbnail record so it doesn't linger with isGenerating: true
        if (thumbnail?._id) {
            try {
                await Thumbnail.findByIdAndDelete(thumbnail._id);
            } catch (cleanupError) {
                console.log('Failed to clean up stuck thumbnail record:', cleanupError);
            }
        }

        res.status(500).json({ message: 'Thumbnail generation failed' });
    } finally {
        if (generationLock) {
            try {
                await User.updateOne(
                    {_id: generationLock.userId, generationLockUntil: generationLock.until},
                    {$unset: {generationLockUntil: 1}}
                )
            } catch (cleanupError) {
                console.error('Failed to release thumbnail generation lock:', cleanupError)
            }
        }
        if (tempFilePath) {
            try {
                fs.unlinkSync(tempFilePath)
            } catch (cleanupError: any) {
                if (cleanupError.code !== 'ENOENT') {
                    console.error('Failed to clean up temporary image:', cleanupError)
                }
            }
        }
    }
}


// Controllers For Thumbnail Deletion
export const deleteThumbnail = async (req: Request, res: Response)=>{
    try {
        const {id} = req.params;
        const {userId} = req.session;

        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ message: 'Invalid thumbnail ID' })
        }

        const thumbnail = await Thumbnail.findOne({_id: id, userId})
        if (!thumbnail) {
            return res.status(404).json({ message: 'Thumbnail not found' })
        }
        const publicId = thumbnail.public_id || getLegacyPublicId(thumbnail.image_url)
        if (publicId) {
            await cloudinary.uploader.destroy(publicId, {resource_type: 'image'})
        }
        await thumbnail.deleteOne()

        res.json({ message: 'Thumbnail deleted successfully'});
    } catch (error: any) {
        console.log(error);
        res.status(500).json({ message: 'Thumbnail deletion failed' });
    }
}
