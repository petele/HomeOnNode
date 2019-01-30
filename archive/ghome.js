/* eslint-disable */
'use strict';

const log = require('./SystemLog2');
const GoogleHome = require('./GoogleHome');
const audioURL = 'http://192.168.86.210:3000/sounds/home.mp3';
const imageURL = 'https://lh4.ggpht.com/ec_XWKslbiFrRDdQkK6Gkoja-XDH4GyuljAQfuaMo3ul710wlzN4JZ29iLqJOE8Z0RnLPEm-3w';

const googleHome = new GoogleHome('192.168.86.243');
googleHome.on('device_info_changed', (data) => {
  log.log('APP', 'device_info_changed', data);
});


googleHome.say('This should be normal.');
googleHome.say('This should be loud!', 90);
googleHome.say('This should be quiet!', 10);

const photoMeta = {
  contentType: 'image/jpeg',
  streamType: 'NONE',
  duration: 30,
  metadata: {
    metadataType: 4,
    title: 'Title',
    artist: 'Artist',
    location: 'Seattle, WA',
  },
}
googleHome.play(imageURL, photoMeta);


const songMeta = {
  contentType: 'image/jpeg',
  streamType: 'LIVE',
  duration: 30,
  metadata: {
    metadataType: 3,
    albumName: 'Album Name',
    title: 'Title of Track',
    artist: 'Artist',
    trackNumber: 3,
    images: [{
      url: imageURL,
      height: 512,
      width: 512,
    }],
  },
}
googleHome.play(imageURL, songMeta);


const repeatMeta = {
  contentType: 'audio/mp3',
  streamType: 'BUFFERED',
  volume: {level: 0.9},
  repeatMode: 'REPEAT_SINGLE',
  metadata: {
    metadataType: 3,
    albumName: 'Album Name',
    title: 'Title of Track',
    artist: 'Artist',
    trackNumber: 3,
    images: [{
      url: imageURL,
      height: 512,
      width: 512,
    }],
  },
}
googleHome.play(audioURL, repeatMeta);
