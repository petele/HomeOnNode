'use strict';

var HueApi = require('../app/node_modules/node-hue-api/index').HueApi;
var Keys = require('../app/Keys').keys;
var wr = require('../app/webRequest');

function handleResponse(err, result) {
  console.log('complete', err, result);
}

// function deleteScene(sceneId) {
//   var basePath = '/api/' + Keys.hueBridge.key + '/scenes/';
//   var uri = {
//     host: hubIP,
//     path: basePath + sceneId,
//     method: 'DELETE'
//   };
//   wr.request(uri, null, handleResponse);
// }

// function deleteScenes(callback) {
//   hue.getScenes(function(err, result) {
//     var scenes = [];
//     result.forEach(function(scene, i) {
//       setTimeout(function() {
//         deleteScene(scene.id);
//       }, (i+1) * 100)
//     });
//     callback(scenes);
//   });
// }

var hubIP = '10.0.0.210';
var hue = new HueApi(hubIP, Keys.hueBridge.key, null, null, 'HomeOnNode-');

// var lights = [1,2,3,4,5,6,7,8,9,10,18];
// var sceneName = 'Chill';
// hue.createScene(lights, sceneName, handleResponse);

// hue.activateScene('HomeOnNode-0', handleResponse);