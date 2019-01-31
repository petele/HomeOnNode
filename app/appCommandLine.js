#!/usr/bin/env node

/* eslint no-console: ["error", { "allow": ["error"] }] */


'use strict';

const log = require('./SystemLog2');
const Keys = require('./Keys').keys;
const Firebase = require('firebase');
const inquirer = require('inquirer');

const LOG_PREFIX = 'CMD';

let commands;

/**
 * Shows the prompt with a list of commands
 */
function prompt() {
  const choices = [];
  choices.push({name: '-Exit-', value: '--EXIT--'});
  Object.keys(commands).forEach((key) => {
    const command = commands[key];
    const item = {};
    if (command.label) {
      item.name = `${command.label} (${key}) [${command.kind}]`;
    } else {
      item.name = `${key} [${command.kind}]`;
    }
    item.value = key;
    choices.push(item);
  });
  const question = {
    type: 'list',
    name: 'commandToRun',
    message: 'What command do you want to run?',
    paginated: true,
    choices: choices,
    pageSize: 20,
  };
  inquirer.prompt([question])
    .then((answer) => {
      const cmdToRun = answer.commandToRun;
      if (cmdToRun === '--EXIT--') {
        process.exit(0);
      }
      return fb.child('commands').push({cmdName: cmdToRun});
    })
    .then((snapshot) => {
      prompt();
    });
}

const fb = new Firebase(`https://${Keys.firebase.appId}.firebaseio.com/`);
fb.authWithCustomToken(Keys.firebase.key, function(error, authToken) {
  if (error) {
    log.exception(LOG_PREFIX, 'Firebase auth failed.', error);
    process.exit(1);
  } else {
    log.log(LOG_PREFIX, 'Firebase auth success.');
    fb.child('config/HomeOnNode/commands').on('value', (snapshot) => {
      commands = snapshot.val();
      // console.log(commands)
      prompt();
    });
  }
});
