const {S3Client, DeleteObjectCommand} = require('@aws-sdk/client-s3');

const multer = require('multer');
const multerS3 = require('multer-s3');
const {v4: uuidv4} = require('uuid');
const path = require('path');

const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials:{
        accessKeyId:process.env.AWS_SECRET_ACCESS_KEY,
    },
});


//allowed files types
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];

const fileFilter = (req, file, cb) => {
    if(ALLOWED_IMAGE_TYPES.includes(file.mimetype)){
        cb(null, true);
    }else{
        cb(new Error('Only image files are allowed(jpg, png, gif, webp, svg'), false);
    }
};

//multer-S3 upload config
const uploadToS3 = multer({
    storage: multerS3({
        s3: s3Client,
        bucket: process.env.AWS_S3_BUCKET,
        contentType: multerS3.AUTO_CONTENT_TYPE,
        key: (req, file, cb) => {
            const ext = path.extname(file.originalname);
            const filename = `template-image/${req.user.id}/${uuidv4()}${ext}`;
            cb(null, filename);
        },
        acl: 'public-read',
    }),
    limits: {fileSize: 5*1024*1024}, //5mb
    fileFilter,
});


//delete from S3
const deleteFromS3 = async (fileUrl) => {
    try{
        const key = fileUrl.split('.amazonaws.com/')[1];
        await s3Client.send(
            new DeleteObjectCommand({Bucket: process.env.AWS_S3_BUCKET, Key:key})
        );
    }catch(error){
        console.error('S3 delete error :', error.message);
    }
};

module.exports = {uploadToS3, deleteFromS3, s3Client};