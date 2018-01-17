'use strict';

const fs = require('fs');
// const Keys = require('../../app/Keys').keys;
const request = require('request');
// const commander = require('commander');
const log = require('npmlog');

// const requestTimeout = 30000;
// const hueIP = '192.168.86.206';
// let recipes;

const HUE_IP = '192.168.86.206';
const HUE_KEY = '9075e416a7d67c2f6c7d9386dff2e591';
const REQUEST_TIMEOUT = 30000;

function readJSONFile(filename) {
  return new Promise((resolve, reject) => {
    let result;
    try {
      result = fs.readFileSync(filename, 'utf8');
    } catch (ex) {
      reject(ex);
      return;
    }
    try {
      result = JSON.parse(result);
      resolve(result);
    } catch (ex) {
      reject(ex);
    }
    return;
  });
}

function setLights(filename) {
  return Promise.all([readJSONFile(filename), readJSONFile('recipes.json')])
    .then((p) => {
      const scene = p[0];
      const recipes = p[1];
      const results = [];
      scene.lights.forEach((light) => {
        const state = {};
        const recipe = getRecipe(light.cmdName, recipes);
        Object.keys(recipe).forEach((k) => {
          state[k] = recipe[k];
        });
        if (light.state) {
          Object.keys(light.state).forEach((k) => {
            state[k] = light.state[k];
          });
        }
        results.push(setLight(light.id, state));
      });
      return Promise.all(results);
    });
}

function getRecipe(recipeName, recipes) {
  if (recipeName) {
    const recipe = recipes[recipeName];
    if (recipe && recipe.hue) {
      return recipe.hue;
    }
  }
  return {};
}

function setLight(lightID, state) {
  const method = 'PUT';
  const path = `lights/${lightID}/state`;
  return makeRequest(method, path, state);
}


// function createScene(filename) {
//   log.log(LOG_PREFIX, `Create scene from ${filename}`);
//   const sceneObj = readSceneFile(filename);
//   if (sceneObj.sceneId) {
//     log.error(LOG_PREFIX, `Create failed: ${filename} already has a sceneId field.`);
//     log.error(LOG_PREFIX, `Use 'update' instead.`);
//     process.exit(1);
//   }
//   readRecipeFile(commander.recipeFile);
//   setLightState(sceneObj.lights, function(lightList) {
//     var appDataValue = 'HoN';
//     if (sceneObj.showInWebUI) {
//       appDataValue += ',UI';
//     }
//     var scene = {
//       name: sceneObj.sceneName,
//       lights: lightList,
//       recycle: false,
//       appdata: {data: appDataValue, version: 4}
//     };
//     if (sceneObj.transitionTime) {
//       scene.transitiontime = sceneObj.transitionTime;
//     }
//     makeRequest('POST', 'scenes/', scene)
//     .then(function(result) {
//       if (result && result[0] && result[0].success) {
//         let id = result[0].success.id;
//         sceneObj.sceneId = id;
//         saveSceneFile(filename, sceneObj);
//       } else {
//         log.warn(LOG_PREFIX, 'Scene not saved.');
//       }
//       return commandCompleted(result);
//     });
//   });
// }

// function deleteScene(sceneID) {
//   log.log(LOG_PREFIX, `Delete scene ${sceneID}`);
//   makeRequest('DELETE', 'scenes/' + sceneID, null, commandCompleted);
// }

// function updateScene(filename) {
//   log.log(LOG_PREFIX, `Update scene from ${filename}`);
//   let sceneObj = readSceneFile(filename);
//   if (!sceneObj.sceneId) {
//     log.error(LOG_PREFIX, 'File is missing `sceneId` field.');
//     return;
//   }
//   readRecipeFile(commander.recipeFile);
//   setLightState(sceneObj.lights, function(lightList) {
//     let scene = {
//       name: sceneObj.sceneName,
//       lights: lightList,
//       storelightstate: true
//     };
//     if (sceneObj.transitionTime) {
//       sceneObj.transitiontime = sceneObj.transitionTime;
//     }
//     makeRequest('PUT', 'scenes/' + sceneObj.sceneId, scene, commandCompleted);
//   });
// }

// function getScenes() {
//   makeRequest('GET', 'scenes/', null, function(sceneList) {
//     var keys = Object.keys(sceneList);
//     keys.forEach(function(key) {
//       var k = key + '                            ';
//       k = k.substring(0, 16);
//       let sceneName = sceneList[key].name;
//       //TODO
//       // log.info(k, sceneName);
//     });
//   });
// }


// function commandCompleted(body) {
//   if (Array.isArray(body) !== true) {
//     log.warn(LOG_PREFIX, `Expected body to be Array by it was ${typeof body}`);
//     log.log(LOG_PREFIX, 'Complete', body);
//     return;
//   }
//   body.forEach(function(resp) {
//     if (resp.success) {
//       log.log(LOG_PREFIX, `Command completed successfully: ${resp.success}`);
//     } else {
//       log.warn(LOG_PREFIX, `Command completed: ${resp}`);
//     }
//   });
//   return body;
// }

// function saveSceneFile(filename, sceneObj) {
//   log.debug(LOG_PREFIX, `Saving ${filename}`);
//   try {
//     let jsonified = JSON.stringify(sceneObj, null, 2);
//     fs.writeFileSync(filename, jsonified, 'utf8');
//     log.log(LOG_PREFIX, `${sceneObj.sceneName} as ${sceneObj.sceneId}`);
//     return sceneObj;
//   } catch (ex) {
//     log.error(LOG_PREFIX, 'Error: could not write scene definition file.');
//     //TODO
//     process.exit(1);
//   }
// }

// function readSceneFile(filename) {
//   var result;
//   try {
//     log.debug(LOG_PREFIX, `readSceneFile: Reading ${filename}`);
//     result = fs.readFileSync(filename);
//   } catch (ex) {
//     log.error('', 'Error: could not read scene definition file.');
//     process.exit(1);
//   }
//   try {
//     log.verbose('readSceneFile', 'Parsing');
//     result = JSON.parse(result);
//   } catch (ex) {
//     log.error('', 'Error: could not parse scene definition file.');
//     process.exit(1);
//   }
//   log.verbose('readSceneFile', 'Validating [sceneName]');
//   if (!result.sceneName) {
//     log.error('', 'ERROR: Scene definition file is missing sceneName');
//     process.exit(1);
//   }
//   if (!result.lights) {
//     result.lights = [];
//   }
//   if (result.scenes) {
//     result.scenes.forEach(function(sceneFile) {
//       let scene = readSceneFile(sceneFile);
//       result.lights = result.lights.concat(scene.lights);
//     });
//   }
//   log.verbose('readSceneFile', 'Validating [lights]');
//   if (Array.isArray(result.lights) === false || result.lights.length === 0) {
//     log.error('', 'ERROR: Scene definition file doesn\'t contain lights array');
//     process.exit(1);
//   }
//   return result;
// }

// function readRecipeFile(filename) {
//   var result = {};
//   var scenes;
//   try {
//     log.verbose('readRecipeFile', 'Reading %s', filename);
//     scenes = fs.readFileSync(filename);
//   } catch (ex) {
//     log.error('readRecipeFile', 'Not found, using default.');
//     process.exit(1);
//   }
//   try {
//     log.verbose('readRecipeFile', 'Parsing');
//     result = JSON.parse(scenes);
//   } catch (ex) {
//     log.error('readRecipeFile', 'Could not parse receipe file.');
//     process.exit(1);
//   }
//   log.verbose('readRecipeFile', 'Recipes: %s', Object.keys(result).join(', '));
//   recipes = result;
// }

// function setLightState(lights, callback) {
//   iterateOverLights(lights, 0, [], function(lightList) {
//     if (callback) {
//       callback(lightList);
//     }
//   });
// }

// function iterateOverLights(lights, index, lightList, callback) {
//   var light = lights[index];
//   if (light) {
//     lightList.push(light.light.toString());
//     var path = 'lights/' + light.light + '/state';
//     var body;
//     if (light.command) {
//       body = light.command;
//     } else if (light.cmdName === 'OFF') {
//       body = {on: false};
//     } else if (light.cmdName) {
//       body = getRecipe(light.cmdName);
//       body.on = true;
//       body.bri = light.bri || 254;
//     } else {
//       log.error('iterateOverLights', 'Missing light command: %j', light);
//       process.exit(1);
//     }
//     log.verbose('iterateOverLights', 'Setting light: %s', light.light);
//     makeRequest('PUT', path, body, function() {
//       iterateOverLights(lights, index + 1, lightList, callback);
//     });
//   } else {
//     callback(lightList);
//   }
// }

// function getRecipe(rName) {
//   rName = rName.toUpperCase();
//   var result = recipes[rName];
//   if (result) {
//     return result.hue;
//   } else {
//     log.error('getRecipe', 'Recipe not found: %s', rName);
//     process.exit(1);
//   }
// }


function makeRequest(method, path, body) {
  return new Promise(function(resolve, reject) {
    const reqOpt = {
      url: 'http://' + HUE_IP + '/api/' + HUE_KEY + '/' + path,
      method: method,
      timeout: REQUEST_TIMEOUT,
      json: true,
    };
    if (body) {
      reqOpt.body = body;
    }
    const prefix = method + ' ' + path;
    log.info(prefix, body);
    request(reqOpt, function(error, response, body) {
      const respPrefix = 'RESP ' + path;
      let result = body;
      if (error) {
        log.error(respPrefix, error);
        result = [{failed: error}];
        reject(result);
      } else {
        log.info(respPrefix, body);
        resolve(result);
      }
    });
  });
}

exports.setLights = setLights;
// exports.getScenes = getScenes;
// exports.createScene = createScene;
// exports.deleteScene = deleteScene;
// exports.updateScene = updateScene;
