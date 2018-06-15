#!/usr/bin/env node
'use strict';

/* eslint no-console: "off", require-jsdoc: "off" */

const util = require('util');
const chalk = require('chalk');
const glob = require('globule');
const commander = require('commander');
const hseLib = require('./lib/HueSceneEditor');
const Keys = require('../app/Keys.js').keys;

console.log(chalk.bold('HomeOnNode Hue Scene Helper'));

const RE_ROOM_ID = /_r(\d\d)/;
const DELAY_BETWEEN_EXTRA = 60;
const DELAY_BETWEEN_REQUESTS = 350;
const DELAY_BETWEEN_ACTIONS = 1500;

const UTIL_OPTS = {
  colors: true,
  maxArrayLength: 20,
  breakLength: 1000,
};
const UTIL_OPTS_PRETTY = {
  colors: true,
  compact: false,
  depth: 4,
  maxArrayLength: 50,
};

function initHSE() {
  const opts = {
    key: commander.key || Keys.hueBridge.key,
    address: commander.address || '192.168.86.206',
    verbose: commander.verbose,
    secure: !commander.insecure,
    trial: commander.trial,
  };
  hseLib.init(opts);
}

commander
  .version('0.8.6')
  .option('-a, --address <address>', 'Address to use')
  .option('-k, --key <key>', 'Hue Key')
  .option('-i, --insecure', 'Insecure, use HTTP only')
  .option('-v, --verbose', 'Verbose output')
  .option('-t, --trial', 'Trial only, don\'t make requests.')
  .option('-r, --recipeFile <filename>', 'Read [recipes.json]', 'recipes.json');

commander
  .command('recipes')
  .description('Lists all of the possible recipes')
  .action(() => {
    const recipes = hseLib.getRecipes();
    const keys = Object.keys(recipes);
    keys.forEach(function(key) {
      const k = chalk.cyan(key.padEnd(16, ' '));
      console.log(k, util.inspect(recipes[key].hue, UTIL_OPTS));
    });
  });

commander
  .command('get <sceneID>')
  .description('Gets the details of the specified scene.')
  .action((sceneID) => {
    initHSE();
    hseLib.getScene(sceneID)
      .then((scene) => {
        console.log(util.inspect(scene, UTIL_OPTS_PRETTY));
      });
  });

commander
  .command('rename <sceneID> <name>')
  .description('Renames a scene.')
  .action((sceneID, sceneName) => {
    initHSE();
    return hseLib.renameScene(sceneID, sceneName).then((results) => {
      hseLib.printResults(results);
    });
  });

commander
  .command('save <sceneID> <filename>')
  .description('Actives scene and saves all info to a file.')
  .action((sceneID, filename) => {
    initHSE();
    return backupScene(sceneID, filename).then((result) => {
      console.log(util.inspect(result, UTIL_OPTS_PRETTY));
    });
  });

commander
  .command('backup')
  .description('Lists all of the current scenes')
  .action(() => {
    initHSE();
    hseLib.listScenes()
      .then((scenes) => {
        const keys = Object.keys(scenes);
        backupScenes(keys);
      });
  });

commander
  .command('list')
  .description('Lists all of the current scenes')
  .action(() => {
    initHSE();
    hseLib.listScenes()
      .then((scenes) => {
        const keys = Object.keys(scenes);
        keys.forEach(function(key) {
          const k = key.padEnd(16, ' ');
          let a = '';
          if (scenes[key].appdata && scenes[key].appdata.data) {
            a = scenes[key].appdata.data;
          }
          a = a.padEnd(14, ' ')
          // try {
          //   a = scenes[key].appdata.data.padEnd(14, ' ');
          // } catch (ex) {
          //   console.log('err', scenes[key]);
          // }
          let n = scenes[key].name;
          // let v = scenes[key].version;
          if (scenes[key].version < 2) {
            n = `${n} ${chalk.red('(v1)')}`;
          }
          console.log(chalk.cyan(k), chalk.magenta(a), n);
        });
      });
  });

commander
  .command('activate <sceneID>')
  .description('Activates the specified scene.')
  .action((sceneID) => {
    initHSE();
    return hseLib.activateScene(sceneID)
      .then((results) => {
        hseLib.printResults(results);
      });
  });

commander
  .command('delete <sceneID>')
  .description('Delete an existing scene.')
  .action((sceneID) => {
    initHSE();
    return hseLib.deleteScene(sceneID)
      .then((results) => {
        hseLib.printResults(results);
      });
  });

commander
  .command('set <filename>')
  .description('Sets all lights in a scene definition file to their settings.')
  .action((filename) => {
    initHSE();
    return makeScenes([filename]);
  });

commander
  .command('update <filename>')
  .description('Update an existing scene.')
  .action((filename) => {
    initHSE();
    return makeScenes([filename], true, false);
  });

commander
  .command('folder <folder>')
  .description('Set scenes from all files in folder.')
  .action((folder) => {
    initHSE();
    const files = glob.find('*.json', {prefixBase: true, srcBase: folder});
    return makeScenes(files, true, true);
  });

function allOffAndWait() {
  return hseLib.allOff()
    .then(() => {
      console.log(' Waiting for lights to catch up...');
      return hseLib.wait(DELAY_BETWEEN_ACTIONS);
    });
}

async function backupScenes(scenes) {
  for (let i = 0; i < scenes.length; i++) {
    await hseLib.wait(DELAY_BETWEEN_REQUESTS);
    const sceneID = scenes[i];
    const filename = `backup/${sceneID}.json`;
    backupScene(sceneID, filename);
  }
}

async function backupScene(sceneID, filename) {
  const scene = await hseLib.getScene(sceneID);
  const results = {
    sceneName: scene.name,
    sceneId: sceneID,
    sceneData: scene.appdata,
    sceneVersion: scene.version,
  };
  if (scene.appdata && scene.appdata.data) {
    const matches = scene.appdata.data.match(RE_ROOM_ID);
    if (matches && matches[1]) {
      results.room = {id: parseInt(matches[1])};
    }
  }
  results.lights = [];
  Object.keys(scene.lightstates).forEach((lightId) => {
    const lightState = scene.lightstates[lightId];
    results.lights.push({
      lightId: parseInt(lightId),
      command: lightState,
    });
  });
  let cSceneID = chalk.cyan(sceneID);
  if (scene.version < 2) {
    cSceneID = chalk.red(sceneID);
  }
  const cFilename = chalk.cyan(filename);
  console.log(`Saved ${cSceneID} to ${cFilename}`);
  hseLib.saveJSONFile(filename, results);
  return results;
}

async function setScene(sceneObj) {
  let lightList = {};
  console.log('setScene', chalk.cyan(sceneObj.sceneName));
  const lightsInScene = {};
  if (sceneObj.scenes) {
    for (let i = 0; i < sceneObj.scenes.length; i++) {
      const filename = sceneObj.scenes[i];
      const subSceneObj = hseLib.readJSONFile(filename);
      const lights = await setScene(subSceneObj);
      lightList = Object.assign(lightList, lights);
      await hseLib.wait(DELAY_BETWEEN_REQUESTS);
    }
  }
  if (sceneObj.lights) {
    let hasErrors = false;
    for (let i = 0; i < sceneObj.lights.length; i++) {
      const light = sceneObj.lights[i];
      const r = await hseLib.setLight(light);
      if (hseLib.printResults(r, false)) {
        hasErrors = true;
      }
      await hseLib.wait(DELAY_BETWEEN_REQUESTS);
      lightList[light.lightId] = true;
    }
    if (hasErrors) {
      throw new Error('Unable to set lights.');
    }
    const check = chalk.green('✔');
    const numLights = sceneObj.lights.length;
    const delay = DELAY_BETWEEN_EXTRA * numLights;
    console.log(' ', `${check} Set ${chalk.cyan(numLights)} lights, waiting ${delay}ms`);
    await hseLib.wait(delay);
  }
  return lightList;
}

async function makeScenes(files, save, startOff) {
  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    console.log('Reading: ', chalk.cyan(filename));
    const sceneObj = hseLib.readJSONFile(filename);
    if (startOff) {
      await allOffAndWait();
      await hseLib.wait(DELAY_BETWEEN_ACTIONS);
    }
    const lightList = await setScene(sceneObj);
    const lights = Object.keys(lightList);
    if (save) {
      await hseLib.wait(DELAY_BETWEEN_ACTIONS / 2);
      if (sceneObj.sceneId) {
        const results = await hseLib.updateScene(sceneObj, lights);
        hseLib.printResults(results, true);
      } else {
        const results = await hseLib.createScene(sceneObj, lights);
        if (results && results[0] && results[0].success) {
          sceneObj.sceneId = results[0].success.id;
          hseLib.saveJSONFile(filename, sceneObj);
        }
        hseLib.printResults(results, true);
      }
    }
    if (i + 1 < files.length) {
      await hseLib.wait(DELAY_BETWEEN_ACTIONS);
    }
  }
}

commander.parse(process.argv);
if (commander.args.length === 0) {
  commander.help();
}


process.on('unhandledRejection', (reason, p) => {
  console.log('An unhandled promise rejection occured.', reason);
});
