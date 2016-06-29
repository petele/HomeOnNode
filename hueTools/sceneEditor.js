#!/usr/bin/env node
'use strict';

var fs = require('fs');
var Keys = require('../app/Keys').keys;
var request = require('request');
var commander = require('commander');
var log = require('npmlog');

var requestTimeout = 30000;
var hueIP = '192.168.1.206';
var recipes;

console.log('HomeOnNode Hue Scene Helper');

commander
  .version('0.1.0')
  .option('-v, --verbose', 'Verbose output')
  .option('-t, --trial', 'Trial only, don\'t make requests.')
  .option('-r, --recipes <filename>', 'Recipes [recipes.json]', 'recipes.json');

commander
  .command('set <filename>')
  .description('Sets all lights in a scene definition file to their settings.')
  .action(function(filename) {
    setLogLevel(commander.verbose);
    log.info('', 'Setting lights based on %s', filename);
    var sceneObj = readSceneFile(filename);
    readRecipeFile(commander.recipes);
    setLights(sceneObj.lights);
  });

commander
  .command('list')
  .description('Lists all of the possible scenes')
  .action(function() {
    readRecipeFile(commander.recipes);
    var keys = Object.keys(recipes);
    keys.forEach(function(key) {
      var k = key + '                            ';
      k = k.substring(0, 20);
      log.info(k, JSON.stringify(recipes[key]));
    });
  });

commander
  .command('create <filename>')
  .description('Create a new scene based on the scene file.')
  .action(function(filename) {
    setLogLevel(commander.verbose);
    log.info('', 'Create scene from %s', filename);
    var sceneObj = readSceneFile(filename);
    readRecipeFile(commander.recipes);
    setLights(sceneObj.lights, function(lightList) {
      var scene = {
        name: sceneObj.sceneName,
        lights: lightList,
        recycle: false,
        appdata: {data: 'HomeOnNode', version: 3}
      };
      if (sceneObj.transitionTime) {
        scene.transitiontime = sceneObj.transitionTime;
      }
      makeRequest('POST', 'scenes/', scene, commandCompleted);
    });
  });

commander
  .command('delete <sceneID>')
  .description('Delete an existing scene.')
  .action(function(sceneID) {
    setLogLevel(commander.verbose);
    log.info('', 'Delete scene %s', sceneID);
    makeRequest('DELETE', 'scenes/' + sceneID, null, commandCompleted);
  });

commander
  .command('update <sceneID> <filename>')
  .description('Update an existing scene.')
  .action(function(sceneID, filename) {
    setLogLevel(commander.verbose);
    log.info('', 'Update scene %s from %s', sceneID, filename);
    var sceneObj = readSceneFile(filename);
    readRecipeFile(commander.recipes);
    setLights(sceneObj.lights, function(lightList) {
      var scene = {
        name: sceneObj.sceneName,
        lights: lightList,
        storelightstate: true
      };
      if (sceneObj.transitionTime) {
        scene.transitiontime = sceneObj.transitionTime;
      }
      makeRequest('PUT', 'scenes/' + sceneID, scene, commandCompleted);
    });
  });

commander.parse(process.argv);
if (commander.args.length === 0) {
  commander.help();
}

function setLogLevel(verbose) {
  if (verbose === true) {
    log.level = 'verbose';
  }
}

function commandCompleted(body) {
  if (Array.isArray(body) !== true) {
    log.warn('Complete', 'Expected body to be Array by it was %s', typeof body);
    log.info('Complete', body);
    return;
  }
  body.forEach(function(resp) {
    if (resp.success) {
      log.info('Complete', 'Command completed successfully: %j', resp.success);
    } else {
      log.warn('Complete', 'Command completed: %j', resp);
    }
  });
}

function readSceneFile(filename) {
  var result;
  try {
    log.verbose('readSceneFile', 'Reading %s', filename);
    result = fs.readFileSync(filename);
  } catch (ex) {
    log.error('', 'Error: could not read scene definition file.');
    process.exit(1);
  }
  try {
    log.verbose('readSceneFile', 'Parsing');
    result = JSON.parse(result);
  } catch (ex) {
    log.error('', 'Error: could not parse scene definition file.');
    process.exit(1);
  }
  log.verbose('readSceneFile', 'Validating [sceneName]');
  if (!result.sceneName) {
    log.error('', 'ERROR: Scene definition file is missing sceneName');
    process.exit(1);
  }
  log.verbose('readSceneFile', 'Validating [lights]');
  if (Array.isArray(result.lights) === false) {
    log.error('', 'ERROR: Scene definition file doesn\'t contain lights array');
    process.exit(1);
  }
  return result;
}

function readRecipeFile(filename) {
  var result = {};
  var scenes;
  try {
    log.verbose('readRecipeFile', 'Reading %s', filename);
    scenes = fs.readFileSync(filename);
  } catch (ex) {
    log.error('readRecipeFile', 'Not found, using default.');
    process.exit(1);
  }
  try {
    log.verbose('readRecipeFile', 'Parsing');
    scenes = JSON.parse(scenes);
    scenes.forEach(function(scene) {
      result[scene.id] = JSON.parse(scene.cmd);
    });
  } catch (ex) {
    log.error('readRecipeFile', 'Could not parse receipe file.');
    process.exit(1);
  }
  log.verbose('readRecipeFile', 'Recipes: %s', Object.keys(result).join(', '));
  recipes = result;
}

function setLights(lights, callback) {
  iterateOverLights(lights, 0, [], function(lightList) {
    if (callback) {
      callback(lightList);
    }
  });
}

function iterateOverLights(lights, index, lightList, callback) {
  var light = lights[index];
  if (light) {
    lightList.push(light.light.toString());
    var path = 'lights/' + light.light + '/state';
    var body;
    if (light.command) {
      body = light.command;
    } else if (light.cmdName === 'OFF') {
      body = {on: false};
    } else if (light.cmdName) {
      body = getRecipe(light.cmdName);
      body.on = true;
      body.bri = light.bri || 254;
    } else {
      log.error('iterateOverLights', 'Missing light command: %j', light);
      process.exit(1);
    }
    log.verbose('iterateOverLights', 'Setting light: %s', light.light);
    makeRequest('PUT', path, body, function() {
      iterateOverLights(lights, index + 1, lightList, callback);
    });
  } else {
    callback(lightList);
  }
}

function getRecipe(rName) {
  rName = rName.toUpperCase();
  var result = recipes[rName];
  if (result) {
    return result;
  } else {
    log.error('getRecipe', 'Recipe not found: %s', rName);
    process.exit(1);
  }
}

function makeRequest(method, path, body, callback) {
  var reqOpt = {
    url: 'http://' + hueIP + '/api/' + Keys.hueBridge.key + '/' + path,
    method: method,
    timeout: requestTimeout
  };
  if (body) {
    reqOpt.json = true;
    reqOpt.body = body;
  }
  var prefix = method + ' ' + path;
  if (commander.trial === true) {
    log.info(prefix, body);
    if (callback) {
      callback([{success: {id: '1234abcd', fake: true}}]);
    }
  } else {
    log.verbose(prefix, body);
    request(reqOpt, function(error, response, body) {
      var respPrefix = 'RESP ' + path;
      var result = body;
      if (error) {
        log.error(respPrefix, error);
        result = [{failed: error}];
      } else {
        log.info(respPrefix, body);
      }
      if (callback) {
        callback(result);
      }
    });
  }
}
