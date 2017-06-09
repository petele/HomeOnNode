'use strict';

const helpers = require('./helpers');
// const assert = require('../node_modules/chai').assert;
// const Keys = require('../Keys').keys;

helpers.setBasicLogging();

describe('Template', function() {
  const TEST_TIMEOUT = 5000;
  this.timeout(TEST_TIMEOUT);

  before(function() {});

  describe('#method()', function() {
    it('should pass after 2 seconds', function() {
      return new Promise(function(resolve, reject) {
        setTimeout(function() {
          resolve(true);
        }, 2000);
      });
    });
  });

  after(function() {});
});
