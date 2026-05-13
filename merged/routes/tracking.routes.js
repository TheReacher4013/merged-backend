const express = require('express');
const router = express.Router();
const {
    trackOpen, trackClick, trackUnsubscribe, sendgridWebhook, sesWebhook,
} =  require('../controllers/tracking.controller');

const rawBodyMiddleware = (req, res, next) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk)=>{data += chunk;});
    req.on('end', ()=>{req.rawBody = data; next(); });

};

router.get('/open/:pixelId', trackOpen);
router.get('/click', trackClick);
router.get('/unsubscribe', trackUnsubscribe);

router.post('/webhook/sendgrid', rawBodyMiddleware, sendgridWebhook);

router.post('/webhook/ses', sesWebhook);

module.exports = router;
