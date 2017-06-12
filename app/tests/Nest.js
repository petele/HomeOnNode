'use strict';

const fs = require('fs');
const helpers = require('./helpers');
const assert = require('../node_modules/chai').assert;
const Keys = require('../Keys').keys;

helpers.setBasicLogging();

describe('Nest', function() {
  let _Nest;
  let _nest;

  const READY_TIMEOUT = 100 * 1000;
  const TEST_TIMEOUT = READY_TIMEOUT + (100 * 1000);
  this.timeout(TEST_TIMEOUT);

  const ROOM_MAP = {
    BR: '42iy4aQmhvdKbdBzud-At7X_gKS0QBk1',
    LR: '42iy4aQmhvc0vlu6JWtItrX_gKS0QBk1',
  };

  const _expectedStateCount = 25;

  let _state = {};
  let _stateChangedCount = 0;

  before(function() {
    _Nest = require('../Nest');
    _nest = new _Nest.Nest(Keys.nestTest.token, ROOM_MAP);
    _nest.on('change', function(state) {
      _stateChangedCount++;
      _state = state;
    });
  });

  afterEach(function() {
    return helpers.sleep(3 * 1000);
  });

  describe('init', function() {
    it('should set the house to default values', function() {
      helpers.sleep(6 * 1000)
        .then(function() {
          return _nest.setHome();
        })
        .then(function() {
          return _nest.setTemperature('LR', 72);
        })
        .then(function() {
          return _nest.setTemperature('BR', 72);
        })
        .then(function() {
          return _nest.enableCamera(false);
        });
    });
  });

  describe('#setAway/Home()', function() {
    it('should set house mode to away', function() {
      return _nest.setAway();
    });
    it('should set house mode to home', function() {
      return _nest.setHome();
    });
  });

  describe('#enableCamera()', function() {
    it('should enable the camera', function() {
      return _nest.enableCamera(true);
    });
    it('should disable the camera', function() {
      return _nest.enableCamera(false);
    });
  });

  describe('#runNestFan()', function() {
    it('should start nest fan', function() {
      return _nest.runNestFan('LR', 60);
    });
    it('should stop nest fan', function() {
      return _nest.runNestFan('LR', 0);
    });
    it('should fail to start fan for invalid time', function() {
      return _nest.runNestFan('LR', 18)
        .catch(function(err) {
          assert.equal(err.message, 'invalid_fan_time');
        });
    });
  });

  describe('#adjustTemperature()', function() {
    it('should move the temperature up by 1degF', function() {
      return _nest.adjustTemperature('LR', 'UP');
    });
    it('should move the temperature down by 1degF', function() {
      return _nest.adjustTemperature('LR', 'DOWN');
    });
    it('should fail with bad_room', function() {
      return _nest.adjustTemperature('XX', 'UP')
        .catch(function(err) {
          assert.equal(err.message, 'room_id_not_found');
        });
    });
    it('should fail with bad_direction', function() {
      return _nest.adjustTemperature('LR', 'LEFT')
        .catch(function(err) {
          assert.equal(err.message, 'unknown_direction');
        });
    });
    it('should fail after exceeding max temp', function() {
      return _nest.setTemperature('LR', 90)
        .then(function() {
          return helpers.sleep(2 * 1000);
        })
        .then(function() {
          return _nest.adjustTemperature('LR', 'UP');
        })
        .catch(function(err) {
          assert.equal(err.message, 'temperature_limit_exceeded');
        })
        .then(function() {
          return _nest.setTemperature('LR', 75);
        });
    });
  });

  describe('#setTemperature()', function() {
    it('should set room temp to 73', function() {
      return _nest.setTemperature('LR', 73);
    });
    it('should try and fail to set room temp to 95', function() {
      return _nest.setTemperature('LR', 95)
        .catch(function(err) {
          assert.equal(err.message, 'temperature_limit_exceeded');
        });
    });
    it('should try and fail to set room temp to 55', function() {
      return _nest.setTemperature('LR', 55)
        .catch(function(err) {
          assert.equal(err.message, 'temperature_limit_exceeded');
        });
    });
    it('should fail setting temp for bad room', function() {
      return _nest.setTemperature('XX', 72)
        .catch(function(err) {
          assert.equal(err.message, 'room_id_not_found');
        });
    });
  });

  describe('Nest Status', function() {
    it('should have a complete state object', function() {
      assert.isNotEmpty(_state);
      assert.containsAllKeys(_state, ['devices', 'metadata', 'structures']);
      assert.closeTo(_stateChangedCount, _expectedStateCount, 4);
    });
  });

});
