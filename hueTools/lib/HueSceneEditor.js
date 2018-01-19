'use strict';

const fs = require('fs');
const util = require('util');
const chalk = require('chalk');
const request = require('request');
const Keys = require('../../app/Keys.js').keys;

/** ***************************************************************************
 * Constants & Remark Lint Options
 *****************************************************************************/

let _recipes;
const VERBOSE = false;
const HUE_IP = '192.168.86.206';
const HUE_KEY = Keys.hueBridge.key;
const REQUEST_TIMEOUT = 30000;

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

function getRecipe(recipeName, recipes) {
  if (recipeName) {
    const recipe = recipes[recipeName];
    if (recipe && recipe.hue) {
      return recipe.hue;
    }
  }
  return {};
}

function _setLight(lightID, state) {
  const method = 'PUT';
  const path = `lights/${lightID}/state`;
  return makeRequest(method, path, state);
}


/** ***************************************************************************
 * Task Functions
 *****************************************************************************/

const UTIL_OPTS = {
  colors: true,
  maxArrayLength: 20,
  breakLength: 1000,
}

function printResults(results, throwOnError) {
  if (!Array.isArray(results)) {
    return false;
  }
  let hasErrors = false;
  results.forEach((result) => {
    let prefix;
    let msg;
    if (result.success) {
      prefix = chalk.green('✔');
      msg = util.inspect(result.success, UTIL_OPTS);
    } else if (result.error) {
      const address = result.error.address;
      const description = result.error.description;
      prefix = chalk.red('✘');
      msg = `${chalk.cyan(address)}: ${description}`;
      hasErrors = true;
    } else {
      prefix = chalk.yellow('?');
      msg = util.inspect(result, UTIL_OPTS);
    }
    console.log(' ', prefix, msg);
  });
  if (throwOnError && hasErrors) {
    throw new Error('Request failed.');
  }
  return hasErrors;
}

async function setLight(light) {
  const recipes = getRecipes();
  let state = {on: true};
  const recipe = getRecipe(light.recipeName, recipes);
  state = Object.assign(state, recipe);
  if (light.command) {
    state = Object.assign(state, light.command);
  }
  const results = await _setLight(light.lightId, state);
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

async function createScene(sceneObj, lightList) {
  console.log(`Saving ${chalk.cyan(sceneObj.sceneName)}`);
  let appDataValue = 'HoN';
  if (sceneObj.showInWebUI) {
    appDataValue += ',UI';
  }
  const scene = {
    name: sceneObj.sceneName,
    lights: lightList,
    recycle: false,
    appdata: {data: appDataValue, version: 4},
  };
  if (sceneObj.transitionTime) {
    scene.transitiontime = sceneObj.transitionTime;
  }
  return makeRequest('POST', 'scenes/', scene);
}

function updateScene(sceneObj, lightList) {
  console.log(`Saving ${chalk.cyan(sceneObj.sceneName)} (${sceneObj.sceneId})`);
  const scene = {
    name: sceneObj.sceneName,
    lights: lightList,
    storelightstate: true,
  };
  if (sceneObj.transitionTime) {
    scene.transitiontime = sceneObj.transitionTime;
  }
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
      resolve(respBody);
      return;
    });
  });
}

exports.wait = wait;
exports.allOff = allOff;
exports.setLight = setLight;
exports.getRecipes = getRecipes;
exports.listScenes = listScenes;
exports.createScene = createScene;
exports.deleteScene = deleteScene;
exports.updateScene = updateScene;
exports.printResults = printResults;
exports.readJSONFile = readJSONFile;
exports.saveJSONFile = saveJSONFile;
exports.activateScene = activateScene;
