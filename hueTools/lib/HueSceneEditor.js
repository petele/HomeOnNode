'use strict';

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
  maxArrayLength: 20,
  breakLength: 1000,
}

let _recipes;
let _ready = false;
let _verbose = false;
let _secure = false;
let _trial = false;
let _address;
let _key;


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
  console.log(`Creating ${chalk.cyan(sceneObj.sceneName)}`);
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
  console.log(`Updating ${chalk.cyan(sceneObj.sceneName)} (${sceneObj.sceneId})`);
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
exports.getRecipes = getRecipes;
exports.listScenes = listScenes;
exports.createScene = createScene;
exports.deleteScene = deleteScene;
exports.updateScene = updateScene;
exports.printResults = printResults;
exports.readJSONFile = readJSONFile;
exports.saveJSONFile = saveJSONFile;
exports.activateScene = activateScene;
