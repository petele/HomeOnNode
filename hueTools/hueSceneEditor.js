#!/usr/bin/env node
'use strict';

var fs = require('fs');
var Keys = require('../app/Keys').keys;
var request = require('request');
var commander = require('commander');
var log = require('npmlog');

var requestTimeout = 30000;
var hueIP = '192.168.86.206';
var recipes;

console.log('HomeOnNode Hue Scene Helper');

commander
  .version('0.2.0')
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
  .command('receipies')
  .description('Lists all of the possible receipies')
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
  .command('list')
  .description('Lists all of the current scenes')
  .action(function() {
    log.level = 'error';
    makeRequest('GET', 'scenes/', null, function(sceneList) {
      log.level = 'info';
      var keys = Object.keys(sceneList);
      keys.forEach(function(key) {
        var k = key + '                            ';
        k = k.substring(0, 16);
        let sceneName = sceneList[key].name;
        // let appData = sceneList[key].appdata.data;
        // let lastUpdated = sceneList[key].lastupdated;
        log.info(k, sceneName);
      });
    });

  });

commander
  .command('create <filename>')
  .description('Create a new scene based on the scene file.')
  .action(function(filename) {
    setLogLevel(commander.verbose);
    log.info('', 'Create scene from %s', filename);
    var sceneObj = readSceneFile(filename);
    if (sceneObj.sceneId) {
      log.error('', `Create failed: ${filename} already has a sceneId field.`);
      log.error('', `Use 'update' instead.`);
      process.exit(1);
    }
    readRecipeFile(commander.recipes);
    setLights(sceneObj.lights, function(lightList) {
      var appDataValue = 'HoN';
      if (sceneObj.showInWebUI) {
        appDataValue += ',UI';
      }
      var scene = {
        name: sceneObj.sceneName,
        lights: lightList,
        recycle: false,
        appdata: {data: appDataValue, version: 4}
      };
      if (sceneObj.transitionTime) {
        scene.transitiontime = sceneObj.transitionTime;
      }
      makeRequest('POST', 'scenes/', scene)
      .then(function(result) {
        if (result && result[0] && result[0].success) {
          let id = result[0].success.id;
          sceneObj.sceneId = id;
          saveSceneFile(filename, sceneObj);
        } else {
          log.warn('', 'Scene not saved.');
        }
        return commandCompleted(result);
      });
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
  .command('update <filename>')
  .description('Update an existing scene.')
  .action(function(filename) {
    setLogLevel(commander.verbose);
    log.info('', `Update scene from ${filename}`);
    let sceneObj = readSceneFile(filename);
    readRecipeFile(commander.recipes);
    setLights(sceneObj.lights, function(lightList) {
      let scene = {
        name: sceneObj.sceneName,
        lights: lightList,
        storelightstate: true
      };
      if (sceneObj.transitionTime) {
        sceneObj.transitiontime = sceneObj.transitionTime;
      }
      makeRequest('PUT', 'scenes/' + sceneObj.sceneId, scene, commandCompleted);
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
  return body;
}

function saveSceneFile(filename, sceneObj) {
  log.verbose('saveSceneFile', `Saving ${filename}`);
  try {
    let jsonified = JSON.stringify(sceneObj, null, 2);
    fs.writeFileSync(filename, jsonified, 'utf8');
    log.info('Saved', `${sceneObj.sceneName} as ${sceneObj.sceneId}`);
    return sceneObj;
  } catch (ex) {
    log.error('', 'Error: could not write scene definition file.');
    process.exit(1);
  }
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
  if (!result.lights) {
    result.lights = [];
  }
  if (result.scenes) {
    result.scenes.forEach(function(sceneFile) {
      let scene = readSceneFile(sceneFile);
      result.lights = result.lights.concat(scene.lights);
    });
  }
  log.verbose('readSceneFile', 'Validating [lights]');
  if (Array.isArray(result.lights) === false || result.lights.length === 0) {
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
  return new Promise(function(resolve, reject) {
    var reqOpt = {
      url: 'http://' + hueIP + '/api/' + Keys.hueBridge.key + '/' + path,
      method: method,
      timeout: requestTimeout,
      json: true
    };
    if (body) {
      reqOpt.body = body;
    }
    var prefix = method + ' ' + path;
    if (commander.trial === true) {
      log.info(prefix, body);
      var fakeResult = [{success: {id: '1234abcd', fake: true}}];
      if (callback) {
        callback(fakeResult);
      }
      resolve(fakeResult);
    } else {
      log.verbose(prefix, body);
      request(reqOpt, function(error, response, body) {
        var respPrefix = 'RESP ' + path;
        var result = body;
        if (error) {
          log.error(respPrefix, error);
          result = [{failed: error}];
          reject(result);
        } else {
          log.info(respPrefix, body);
          resolve(result);
        }
        if (callback) {
          callback(result);
        }
      });
    }
  });
}
