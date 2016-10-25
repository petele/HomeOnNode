'use strict';

var fs = require('fs');

var recipes = fs.readFileSync('recipes.json');
recipes = JSON.parse(recipes);
var keys = Object.keys(recipes);

var bracketWords = [
  'DEEP', 'DARK', 'LIGHT', 'COOL', 'MID', 'WARM'
];

var lightRecipes = [];

function camelCase(word) {
  return word.substring(0, 1) + word.substring(1).toLowerCase();
}

keys.forEach(function(key) {
  var label = [];
  var words = key.split('_');
  words.forEach(function(word) {
    if (bracketWords.indexOf(word) >= 0) {
      word = '(' + camelCase(word) + ')';
    } else if (word === 'LS') {
      word = '(LightStrip)';
    } else {
      word = camelCase(word);
    }
    label.push(word);
  });
  var r = {
    cmd: JSON.stringify(recipes[key]),
    label: label.join(' '),
    id: key
  };
  lightRecipes.push(r);
});
console.log(lightRecipes);
fs.writeFileSync('forFB.json', JSON.stringify(lightRecipes, null, 2));
