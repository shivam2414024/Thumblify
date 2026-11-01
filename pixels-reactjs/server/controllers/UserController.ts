import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Thumbnail from '../models/Thumbnail.js';

// Controllers to get All User Thumbnails
export const getUsersThumbnails = async (req: Request, res: Response)=>{
    try {
        const {userId} = req.session;

        const thumbnails = await Thumbnail.find({userId}).sort({createdAt: -1})
        res.json({thumbnails})
    } catch (error: any) {
        console.log(error);
        res.status(500).json({ message: 'Unable to fetch thumbnails' });
    }
}

// Controllers to get single Thumbnail of a User
export const getThumbnailbyId = async (req: Request, res: Response)=>{
    try {
        const {userId} = req.session;
        const { id } = req.params;

        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ message: 'Invalid thumbnail ID' });
        }

        const thumbnail = await Thumbnail.findOne({userId, _id: id});
        if (!thumbnail) {
            return res.status(404).json({ message: 'Thumbnail not found' });
        }
        res.json({thumbnail})
    } catch (error: any) {
        console.log(error);
        res.status(500).json({ message: 'Unable to fetch thumbnail' });
    }
}