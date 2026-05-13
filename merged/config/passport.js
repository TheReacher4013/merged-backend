const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const User = require('../models/User.model');

// Google OAuth Strategy LOGIC
passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: '/api/auth/google/callback',
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                const email = profile.emails[0].value;
                let user = await User.findOne({ email });

                if (user) {
                    // Merge: link googleId to existing account
                    if (!user.googleId) {
                        user.googleId = profile.id;
                        user.authProvider = 'google';
                        user.avatar = user.avatar || profile.photos[0]?.value;
                        await user.save();
                    }
                    return done(null, user);
                }

                // New user — auto-register
                user = await User.create({
                    name: profile.displayName,
                    email,
                    googleId: profile.id,
                    authProvider: 'google',
                    avatar: profile.photos[0]?.value,
                    isEmailVerified: true, // Google already verified
                });

                return done(null, user);
            } catch (error) {
                return done(error, null);
            }
        }
    )
);

//Facebook OAuth Strategy LOGIC 
passport.use(
    new FacebookStrategy(
        {
            clientID: process.env.FACEBOOK_APP_ID,
            clientSecret: process.env.FACEBOOK_APP_SECRET,
            callbackURL: '/api/auth/facebook/callback',
            profileFields: ['id', 'emails', 'name', 'picture'],
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                const email = profile.emails?.[0]?.value;
                if (!email) return done(new Error('Email not provided by Facebook'), null);

                let user = await User.findOne({ email });

                if (user) {
                    if (!user.facebookId) {
                        user.facebookId = profile.id;
                        user.authProvider = 'facebook';
                        await user.save();
                    }
                    return done(null, user);
                }

                user = await User.create({
                    name: `${profile.name.givenName} ${profile.name.familyName}`,
                    email,
                    facebookId: profile.id,
                    authProvider: 'facebook',
                    avatar: profile.photos?.[0]?.value,
                    isEmailVerified: true,
                });

                return done(null, user);
            } catch (error) {
                return done(error, null);
            }
        }
    )
);

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (err) {
        done(err, null);
    }
});

module.exports = passport;