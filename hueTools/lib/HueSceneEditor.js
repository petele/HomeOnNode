'use strict';

const fs = require('fs');
const chalk = require('chalk');
const request = require('request');

let _recipes;

/** ***************************************************************************
 * Constants & Remark Lint Options
 *****************************************************************************/

const VERBOSE = false;
const HUE_IP = '192.168.86.206';
const HUE_KEY = '9075e416a7d67c2f6c7d9386dff2e591';
const REQUEST_TIMEOUT = 30000;
const SLEEP_BETWEEN_REQUESTS = 250;

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
  ms = ms || 1000;
  return new Promise((r) => setTimeout(r, ms));
}

function readJSONFile(filename) {
  let result;
  try {
    result = fs.readFileSync(filename, 'utf8');
  } catch (ex) {
    const msg = `Unable to read ${filename}`;
    throw new Error(msg);
  }
  try {
    result = JSON.parse(result);
    return result;
  } catch (ex) {
    const msg = `Unable to parse ${filename}`;
    throw new Error(msg);
  }
}

function saveJSONFile(filename, obj) {
  const jsonified = JSON.stringify(obj, null, 2);
  fs.writeFileSync(filename, jsonified, 'utf8');
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
    lightList.push(light.light.toString());
  });
  return lightList;
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


/** ***************************************************************************
 * Task Functions
 *****************************************************************************/

function parseResults(results, show) {
  if (!Array.isArray(results)) {
    return false;
  }
  let hasErrors = false;
  results.forEach((result) => {
    let prefix;
    let msg;
    if (result.success) {
      prefix = chalk.green('✔');
      msg = result.success;
    } else if (result.error) {
      const address = result.error.address;
      const description = result.error.description;
      prefix = chalk.red('✘');
      msg = `${chalk.cyan(address)}: ${description}`;
      hasErrors = true;
    } else {
      prefix = chalk.yellow('?');
      msg = result;
    }
    if (show) {
      console.log(' ', prefix, msg);
    }
  });
  return hasErrors;
}

function iterate(state, obj) {
  Object.keys(obj).forEach((k) => {
    if (k === 'light' || k === 'cmdName') {
      return;
    } if (k === 'command') {
      return iterate(state, obj[k]);
    }
    state[k] = obj[k];
  });
}

async function setLights(lights) {
  let results = [];
  const recipes = getRecipes();
  console.log('Setting lights...');
  for (let i = 0; i < lights.length; i++) {
    const light = lights[i];
    const state = {on: true};
    const recipe = getRecipe(light.cmdName, recipes);
    // Object.keys(recipe).forEach((k) => {
    //   state[k] = recipe[k];
    // });
    iterate(state, recipe);
    // Object.keys(light).forEach((k) => {
    //   if (k === 'light' || k === 'cmdName') {
    //     return;
    //   }
    //   if (k === 'command') {

    //   }
    //   state[k] = light[k];
    // });
    iterate(state, light);
    if (i > 0) {
      await wait(SLEEP_BETWEEN_REQUESTS);
    }
    let result = await setLight(light.light, state);
    results = results.concat(result);
  }
  let hasErrors = parseResults(results, false);
  if (hasErrors) {
    throw new Error('Failed while trying to set lights.');
  }
  return results;
}

function listScenes() {
  return makeRequest('GET', 'scenes/', null);
}

function activateScene(sceneID) {
  const body = {scene: sceneID};
  return makeRequest('PUT', 'groups/0/action', body);
}

async function allOff() {
  console.log('Turning all lights off...');
  return makeRequest('PUT', 'groups/0/action', {on: false});
}

function deleteScene(sceneID) {
  return makeRequest('DELETE', 'scenes/' + sceneID, null);
}

async function createScene(sceneObj) {
  console.log('Creating scene...');
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
  return makeRequest('POST', 'scenes/', scene)
    .then((results) => {
      const hasErrors = parseResults(results, false);
      if (results && results[0] && results[0].success) {
        const sceneId = results[0].success.id;
        return sceneId
      }
      throw new Error('Unable to create scene');
    })
}

function updateScene(sceneObj) {
  console.log('Updating scene...');
  const scene = {
    name: sceneObj.sceneName,
    lights: getLightList(sceneObj.lights),
    storelightstate: true,
  };
  if (sceneObj.transitionTime) {
    scene.transitiontime = sceneObj.transitionTime;
  }
  return makeRequest('PUT', `scenes/${sceneObj.sceneId}`, scene)
    .then((results) => {
      const hasErrors = parseResults(results, false);
      if (hasErrors) {
        throw new Error('Unable to update scene');
      }
      return results;
    });
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
    if (VERBOSE) {
      console.log(method, '->', path, body);
    }
    request(reqOpt, function(error, response, respBody) {
      if (error) {
        console.log(method, '<-', path, chalk.red('FAILED'), '\n', error);
        reject([{failed: error}]);
        return;
      }
      if (VERBOSE) {
        console.log(method, '<-', path, respBody);
      }
      parseResults(respBody, true);
      resolve(respBody);
      return;
    });
  });
}

exports.wait = wait;
exports.allOff = allOff;
exports.readJSONFile = readJSONFile;
exports.saveJSONFile = saveJSONFile;
exports.setLights = setLights;
exports.getRecipes = getRecipes;
exports.listScenes = listScenes;
exports.createScene = createScene;
exports.deleteScene = deleteScene;
exports.updateScene = updateScene;
exports.activateScene = activateScene;
