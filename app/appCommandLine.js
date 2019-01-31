#!/usr/bin/env node

'use strict';

const log = require('./SystemLog2');
const Keys = require('./Keys').keys;
const Firebase = require('firebase');
const inquirer = require('inquirer');

let commands;

/**
 * Shows the prompt with a list of commands
 */
function prompt() {
  const choices = [];
  choices.push({name: 'Exit', value: '--EXIT--'});
  choices.push({name: 'Manual Entry', value: '--MANUAL--'});
  choices.push(new inquirer.Separator());
  Object.keys(commands).forEach((key) => {
    const command = commands[key];
    const item = {};
    if (command.label) {
      item.name = `${key} - ${command.label} [${command.kind}]`;
    } else {
      item.name = `${key} [${command.kind}]`;
    }
    item.value = key;
    choices.push(item);
  });
  choices.push(new inquirer.Separator());
  const qCommands = {
    type: 'list',
    name: 'cmdName',
    message: 'What command do you want to run?',
    paginated: true,
    choices: choices,
    pageSize: 20,
  };
  const qManualInput = {
    type: 'input',
    name: 'cmd',
    message: 'Manual command:',
    validate: function(input) {
      if (input === '') {
        return true;
      }
      try {
        JSON.parse(input);
        return true;
      } catch (ex) {
        return `Requires a valid JSON string: ${ex.message}`;
      }
    },
    when: function(answers) {
      return answers.cmdName === '--MANUAL--';
    },
  };
  inquirer.prompt([qCommands, qManualInput])
    .then((answer) => {
      const cmdName = answer.cmdName;
      if (cmdName === '--EXIT--') {
        process.exit(0);
      }
      return fb.child('commands').push({cmdName: cmdName});
    })
    .then((snapshot) => {
      prompt();
    });
}

const fb = new Firebase(`https://${Keys.firebase.appId}.firebaseio.com/`);
fb.authWithCustomToken(Keys.firebase.key, function(error, authToken) {
  if (error) {
    log.exception('FB', 'Firebase auth failed.', error);
    process.exit(1);
  } else {
    fb.child('config/HomeOnNode/commands').on('value', (snapshot) => {
      commands = snapshot.val();
      prompt();
    });
  }
});
