'use strict';

/* eslint no-console: "off" */

const fs = require('fs');
const chalk = require('chalk');
const request = require('request');

let _recipes;

/** ***************************************************************************
 * Constants & Remark Lint Options
 *****************************************************************************/

const VERBOSE = true;
const HUE_IP = '192.168.86.206';
const HUE_KEY = '9075e416a7d67c2f6c7d9386dff2e591';
const REQUEST_TIMEOUT = 30000;
const SLEEP_BETWEEN_REQUESTS = 150;

/** ***************************************************************************
 * Internal Helper Functions
 *****************************************************************************/

/**
 * Waits a specified number of milliseconds
 *
 * @param {number} ms The number of milliseconds to wait.
 * @return {Promise} A promise that resolves after specified time.
 */
function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readJSONFile(filename) {
  let result;
  try {
    result = fs.readFileSync(filename, 'utf8');
  } catch (ex) {
    const msg = `Unable to read ${filename}`;
    console.error(chalk.red('ERROR:'), `${msg}\n${ex}`);
    throw new Error(msg);
  }
  try {
    result = JSON.parse(result);
    return result;
  } catch (ex) {
    const msg = `Unable to parse ${filename}`;
    console.error(chalk.red('ERROR:'), `${msg}\n${ex}`);
    throw new Error(msg);
  }
}

function getRecipes() {
  if (!_recipes) {
    _recipes = readJSONFile('recipes.json');
  }
  return _recipes;
}

function getLightList(lights) {
  const lightList = [];
  lights.forEach((light) => {
    lightList.push(light.light);
  });
  return lightList;
}

async function _setLights(lights) {
  const results = [];
  const recipes = getRecipes();
  for (let i = 0; i < lights.length; i++) {
    const light = lights[i];
    const state = {};
    const recipe = getRecipe(light.cmdName, recipes);
    Object.keys(recipe).forEach((k) => {
      state[k] = recipe[k];
    });
    Object.keys(light).forEach((k) => {
      if (k === 'light' || k === 'cmdName') {
        return;
      }
      state[k] = light[k];
    });
    if (i > 0) {
      await wait(SLEEP_BETWEEN_REQUESTS);
    }
    results.push(await setLight(light.light, state));
  }
  return results;
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

function saveSceneFile(filename, sceneObj) {
  const jsonified = JSON.stringify(sceneObj, null, 2);
  fs.writeFileSync(filename, jsonified, 'utf8');
  return sceneObj;
}

/** ***************************************************************************
 * Task Functions
 *****************************************************************************/

function setLights(filename) {
  const sceneObj = readJSONFile(filename);
  return _setLights(sceneObj.lights);
}

function listScenes() {
  return makeRequest('GET', 'scenes/', null);
}

function activateScene(sceneID) {
  const body = {scene: sceneID};
  return makeRequest('PUT', 'groups/0/action', body);
}

function deleteScene(sceneID) {
  return makeRequest('DELETE', 'scenes/' + sceneID, null);
}

async function createScene(filename) {
  const sceneObj = readJSONFile(filename);
  if (sceneObj.sceneId) {
    return Promise.reject('Scene already exists.');
  }
  await _setLights(sceneObj.lights);
  let appDataValue = 'HoN';
  if (sceneObj.showInWebUI) {
    appDataValue += ',UI';
  }
  const scene = {
    name: sceneObj.sceneName,
    lights: getLightList(sceneObj.lights),
    recycle: false,
    appdata: {data: appDataValue, version: 4},
  };
  if (sceneObj.transitionTime) {
    scene.transitiontime = sceneObj.transitionTime;
  }
  await wait(SLEEP_BETWEEN_REQUESTS);
  return makeRequest('POST', 'scenes/', scene)
    .then((result) => {
      if (result && result[0] && result[0].success) {
        const sceneId = result[0].success.id;
        sceneObj.sceneId = sceneId;
        saveSceneFile(filename, sceneObj);
        return sceneId;
      }
      return result;
    })
}

async function updateScene(filename) {
  const sceneObj = readJSONFile(filename);
  if (!sceneObj.sceneId) {
    return Promise.reject('Scene doesn\'t exist.');
  }
  await _setLights(sceneObj.lights);
  const scene = {
    name: sceneObj.sceneName,
    lights: getLightList(sceneObj.lights),
    storelightstate: true,
  };
  if (sceneObj.transitionTime) {
    scene.transitiontime = sceneObj.transitionTime;
  }
  await wait(SLEEP_BETWEEN_REQUESTS);
  return makeRequest('PUT', `scenes/${sceneObj.sceneId}`, scene);
}


/**
 * Makes a request to the Hue API
 *
 * @param {string} method The HTTP request method.
 * @param {string} path The URL path to request from.
 * @param {Object} <body> The body to send along with the request.
 */
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
    console.log(method, '->', path, body);
    request(reqOpt, function(error, response, body) {
      if (error) {
        console.log(method, '<-', path, chalk.red('FAILED'), '\n', error);
        reject([{failed: error}]);
        return;
      }
      if (VERBOSE) {
        console.log(method, '<-', path, body);
      }
      resolve(body);
    });
  });
}

exports.setLights = setLights;
exports.getRecipes = getRecipes;
exports.listScenes = listScenes;
exports.createScene = createScene;
exports.deleteScene = deleteScene;
exports.updateScene = updateScene;
exports.activateScene = activateScene;
