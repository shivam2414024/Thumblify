import {Request, Response} from 'express'
import User from '../models/User.js';
import bcrypt from 'bcrypt';

// Controllers For User Registration
export const registerUser = async (req: Request, res: Response)=>{
    try {
        const {name, email, password} = req.body;
        if (
            typeof name !== 'string' || !name.trim() ||
            typeof email !== 'string' || !email.trim() ||
            typeof password !== 'string' || password.length === 0
        ) {
            return res.status(400).json({message: 'Name, email, and password are required'})
        }
        if (password.length < 8) {
            return res.status(400).json({message: 'Password must be at least 8 characters'})
        }
        if (Buffer.byteLength(password, 'utf8') > 72) {
            return res.status(400).json({message: 'Password must not exceed 72 UTF-8 bytes'})
        }
        const normalizedName = name.trim()
        const normalizedEmail = email.trim().toLowerCase()
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            return res.status(400).json({message: 'A valid email address is required'})
        }

        // find user by email
        const user = await User.findOne({email: normalizedEmail});
        if(user){
            return res.status(409).json({message: 'User already exists'})
        }

        // Encrypt the password
        const salt = await bcrypt.genSalt(10)
        const hashedPassword = await bcrypt.hash(password, salt)

        const newUser = new User({name: normalizedName, email: normalizedEmail, password: hashedPassword})
        await newUser.save()

        await new Promise<void>((resolve, reject) => {
            req.session.regenerate((error) => {
                if (error) return reject(error)
                resolve()
            })
        })

        // setting user data in session
        req.session.isLoggedIn = true;
        req.session.userId = newUser._id;

        return res.json({
            message: 'Account created successfully',
            user: {
                _id: newUser._id,
                name: newUser.name,
                email: newUser.email
            }
        })

    } catch (error: any) {
        if (error?.code === 11000) {
            return res.status(409).json({message: 'User already exists'})
        }
        console.log(error);
        res.status(500).json({message: 'Unable to create account'})
    }
}

// Controllers For User Login
export const loginUser = async (req: Request, res: Response)=>{
    try{
        const { email, password} = req.body;
        if (
            typeof email !== 'string' || !email.trim() ||
            typeof password !== 'string' || password.length === 0 ||
            Buffer.byteLength(password, 'utf8') > 72
        ) {
            return res.status(400).json({message: 'Invalid email or password'})
        }
        const normalizedEmail = email.trim().toLowerCase()

        // find user by email
        const user = await User.findOne({email: normalizedEmail});
        if(!user){
            return res.status(400).json({message: 'Invalid email or password'})
        }

        const isPasswordCorrect = await bcrypt.compare(password, user.password)
        if(!isPasswordCorrect){
            return res.status(400).json({message: 'Invalid email or password'})
        }

        await new Promise<void>((resolve, reject) => {
            req.session.regenerate((error) => {
                if (error) return reject(error)
                resolve()
            })
        })

        // setting user data in session
        req.session.isLoggedIn = true;
        req.session.userId = user._id;

        return res.json({
            message: 'Login successfully',
            user: {
                _id: user._id,
                name: user.name,
                email: user.email
            }
        })
    } catch (error: any) {
        console.log(error);
        res.status(500).json({message: 'Unable to log in'})
    }
}

// controllers For User Logout
export const logoutUser = async (req: Request, res: Response)=>{
    req.session.destroy((error: any)=>{
        if(error){
            console.log(error)
            return res.status(500).json({message: 'Unable to log out'})
        }
        res.clearCookie('connect.sid', {
            path: '/',
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        })
        return res.json({message: 'Logout successful'})
    })
}

// Controllers For User Verify
export const verifyUser = async (req: Request, res: Response)=>{
    try{
        const { userId } = req.session;

        const user = await User.findById(userId).select('-password')

        if(!user){
            return res.status(400).json({message: 'Invalid user' });
        }

        return res.json({ user });
    } catch (error: any){
        console.log(error);
        res.status(500).json({message: 'Unable to verify session'})
    }
}