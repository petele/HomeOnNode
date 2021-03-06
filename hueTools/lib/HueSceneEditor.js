'use strict';

/* eslint require-jsdoc: "off" */

const fs = require('fs');
const util = require('util');
const chalk = require('chalk');
const request = require('request');
const stripComments = require('strip-json-comments');


/** ***************************************************************************
 * Constants & Remark Lint Options
 *****************************************************************************/

const REQUEST_TIMEOUT = 30000;
const UTIL_OPTS = {
  colors: true,
  maxArrayLength: 50,
  breakLength: 1000,
};

let _recipes;
let _ready = false;
let _verbose = false;
let _secure = false;
let _trial = false;
let _address;
let _key;
let _cachedData;
let _cachedDataExpiresAt = 0;


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
    result = stripComments(result);
  } catch (ex) {
    const msg = `Unable to read ${filename}`;
    throw new Error(msg);
  }
  try {
    return JSON.parse(result);
  } catch (ex) {
    console.log(ex);
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

const _CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
function _randomChar() {
  return _CHARS[Math.floor(Math.random() * 61)];
}

function _generateAppDataValue(roomId, sceneType) {
  let result = 'x' + _randomChar() + _randomChar() + _randomChar() + 'X';
  result += '_r' + roomId.toString().padStart(2, '0');
  if (sceneType) {
    result += '_d' + sceneType.toString().padStart(2, '0');
  } else {
    result += '_d99';
  }
  return result;
}

/** ***************************************************************************
 * Task Functions
 *****************************************************************************/

function init(opts) {
  if (opts.key) {
    _key = opts.key;
  }
  if (opts.address) {
    _address = opts.address;
  }
  if (_key && _address) {
    _ready = true;
  }
  _verbose = opts.verbose === true ? true : false;
  _secure = opts.secure === true ? true : false;
  _trial = opts.trial === true ? true : false;
  if (_trial) {
    console.log(chalk.red('Trial mode'), '- No HTTP requests will be made.');
  }
}

function printResults(results, throwOnError) {
  if (!Array.isArray(results)) {
    console.log(util.inspect(results, UTIL_OPTS));
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

function getScene(sceneId) {
  return makeRequest('GET', `scenes/${sceneId}`, null);
}

function activateScene(sceneID) {
  const body = {scene: sceneID};
  return makeRequest('PUT', 'groups/0/action', body);
}

function deleteScene(sceneID) {
  return makeRequest('DELETE', 'scenes/' + sceneID, null);
}

function renameScene(sceneId, sceneName) {
  const scene = {name: sceneName};
  console.log(`Renaming ${sceneId} to ${chalk.cyan(sceneName)}`);
  return makeRequest('PUT', `scenes/${sceneId}`, scene);
}

async function allOff() {
  console.log('Turning all lights off...');
  return makeRequest('PUT', 'groups/0/action', {on: false});
}

async function createScene(sceneObj, lightList) {
  const scene = {
    name: sceneObj.sceneName,
    lights: lightList,
    recycle: false,
    appdata: {
      data: _generateAppDataValue(sceneObj.roomId, sceneObj.sceneType),
      version: 1,
    },
  };
  if (sceneObj.hasOwnProperty('transitionTime')) {
    scene.transitiontime = sceneObj.transitionTime;
  }
  console.log(`Creating ${chalk.cyan(scene.name)}`);
  return makeRequest('POST', 'scenes/', scene);
}

function updateScene(sceneObj, lightList) {
  const sceneId = sceneObj.sceneId;
  const sceneName = sceneObj.sceneName;
  const scene = {
    name: sceneName,
    lights: lightList,
    storelightstate: true,
  };
  if (sceneObj.hasOwnProperty('transitionTime')) {
    scene.transitiontime = sceneObj.transitionTime;
  }
  console.log(`Updating ${chalk.cyan(sceneName)} (${sceneId})`);
  return makeRequest('PUT', `scenes/${sceneId}`, scene);
}

function getAllData(useCached) {
  if (useCached && _cachedData && _cachedDataExpiresAt < Date.now()) {
    return Promise.resolve(_cachedData);
  }
  return makeRequest('GET', '').then((resp) => {
    _cachedData = resp;
    return resp;
  });
}


/**
 * Makes a request to the Hue API
 *
 * @param {string} method The HTTP request method.
 * @param {string} path The URL path to request from.
 * @param {Object} body The body to send along with the request.
 * @return {Promise}
 */
function makeRequest(method, path, body) {
  return new Promise(function(resolve, reject) {
    if (!_ready) {
      reject('Not setup');
      return;
    }
    const protocol = _secure === true ? 'https' : 'http';
    const reqOpt = {
      url: `${protocol}://${_address}/api/${_key}/${path}`,
      method: method,
      timeout: REQUEST_TIMEOUT,
      json: true,
      strictSSL: false,
    };
    if (body) {
      reqOpt.body = body;
    }
    if (_verbose || _trial) {
      // eslint-disable-next-line max-len
      const m = _trial === true ? chalk.dim(method.toLowerCase()) : chalk.bold(method);
      const b = util.inspect(body, UTIL_OPTS);
      console.log(m, '->', chalk.cyan(reqOpt.url), b);
    }
    if (_trial) {
      resolve(true);
      return;
    }
    request(reqOpt, function(error, response, respBody) {
      if (error) {
        console.log(method, '<-', path, chalk.red('FAILED'), '\n', error);
        reject([{failed: error}]);
        return;
      }
      if (_verbose) {
        console.log(method, '<-', path, respBody);
      }
      resolve(respBody);
      return;
    });
  });
}

exports.init = init;
exports.wait = wait;
exports.allOff = allOff;
exports.setLight = setLight;
exports.getScene = getScene;
exports.getRecipes = getRecipes;
exports.getAllData = getAllData;
exports.listScenes = listScenes;
exports.createScene = createScene;
exports.renameScene = renameScene;
exports.deleteScene = deleteScene;
exports.updateScene = updateScene;
exports.makeRequest = makeRequest;
exports.printResults = printResults;
exports.readJSONFile = readJSONFile;
exports.saveJSONFile = saveJSONFile;
exports.activateScene = activateScene;
