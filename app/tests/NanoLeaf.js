'use strict';

const helpers = require('./helpers');
const assert = require('../node_modules/chai').assert;
const Keys = require('../Keys').keys;

helpers.setBasicLogging();

describe('NanoLeaf', function() {
  let _NanoLeaf;
  let _nanoLeaf;

  const WAIT_FOR_READY = 5 * 1000;
  const WAIT_FOR_UPDATE_TICKS = 100 * 1000;
  const TEST_TIMEOUT = WAIT_FOR_READY + WAIT_FOR_UPDATE_TICKS + (60 * 1000);
  this.timeout(TEST_TIMEOUT);

  const _expectedStateCount = 33;

  let _state = {};
  let _stateChangedCount = 0;

  before(function() {
    _NanoLeaf = require('../NanoLeaf');
    _nanoLeaf = new _NanoLeaf(Keys.nanoLeaf, '192.168.86.208', 16021);
    _nanoLeaf.on('state_changed', function(state) {
      _stateChangedCount++;
      _state = state;
    });
    return helpers.sleep(WAIT_FOR_READY);
  });

  afterEach(function() {
    return helpers.sleep(7500)
      .then(function() {
        return _nanoLeaf.executeCommand({colorTemp: 5000});
      });
  });

  function verify204(resp) {
    assert.equal(resp.statusCode, 204);
  }

  describe('- is the API ready? It', function() {
    it('should turn all lights off', function() {
      return _nanoLeaf.executeCommand(null, 'OFF');
    });
  });

  describe('#executeCommand()', function() {
    describe('effect', function() {
      it('should start Pete1 effect', function() {
        return _nanoLeaf.executeCommand({effect: 'Pete1'}).then(verify204);
      });
      it('should start Nemo effect', function() {
        return _nanoLeaf.executeCommand({effect: 'Nemo'}).then(verify204);
      });
      it('should fail because it can\'t find the effect', function() {
        return _nanoLeaf.executeCommand({effect: 'this-effect-doesnt-exist'})
        .then(verify204);
      });
    });

    describe('brightness', function() {
      it('should set the brightness to 0', function() {
        return _nanoLeaf.executeCommand({brightness: 0}).then(verify204);
      });
      it('should set the brightness to 10', function() {
        return _nanoLeaf.executeCommand({brightness: 10}).then(verify204);
      });
      it('should set the brightness to 50', function() {
        return _nanoLeaf.executeCommand({brightness: 50}).then(verify204);
      });
      it('should set the brightness to 100', function() {
        return _nanoLeaf.executeCommand({brightness: 100}).then(verify204);
      });
      it('should fail to set brighness, value exceeded', function() {
        return _nanoLeaf.executeCommand({brightness: 150})
        .catch(function(err) {
          assert.equal(err.message, 'value_out_of_range');
        });
      });
    });

    describe('colorTemp', function() {
      it('should fail to set the color temperature to 0', function() {
        return _nanoLeaf.executeCommand({colorTemp: 0})
        .catch(function(err) {
          assert.equal(err.message, 'value_out_of_range');
        });
      });
      it('should set the color temperature to 1200', function() {
        return _nanoLeaf.executeCommand({colorTemp: 1200}).then(verify204);
      });
      it('should set the color temperature to 3000', function() {
        return _nanoLeaf.executeCommand({colorTemp: 3000}).then(verify204);
      });
      it('should set the color temperature to 5000', function() {
        return _nanoLeaf.executeCommand({colorTemp: 5000}).then(verify204);
      });
      it('should set the color temperature to 6500', function() {
        return _nanoLeaf.executeCommand({colorTemp: 6500}).then(verify204);
      });
      it('should fail to set the color temperature to 7000', function() {
        return _nanoLeaf.executeCommand({colorTemp: 7000})
        .catch(function(err) {
          assert.equal(err.message, 'value_out_of_range');
        });
      });
    });

    describe('hueAndSat', function() {
      it('should set the hue/sat to red', function() {
        return _nanoLeaf.executeCommand({hue: 0, sat: 100}).then(verify204);
      });
      it('should fail when setting invalid hue', function() {
        return _nanoLeaf.executeCommand({hue: 500, sat: 50})
        .catch(function(err) {
          assert.equal(err.message, 'value_out_of_range');
        });
      });
      it('should fail when setting invalid sat', function() {
        return _nanoLeaf.executeCommand({hue: 0, sat: 150})
        .catch(function(err) {
          assert.equal(err.message, 'value_out_of_range');
        });
      });
      it('should fail when seeting invalid hue/sat', function() {
        return _nanoLeaf.executeCommand({hue: 500, sat: 500})
        .catch(function(err) {
          assert.equal(err.message, 'value_out_of_range');
        });
      });
      it('should set the hue/sat to green', function() {
        return _nanoLeaf.executeCommand({hue: 120, sat: 90}).then(verify204);
      });
      it('should set the hue/sat to blue', function() {
        return _nanoLeaf.executeCommand({hue: 240, sat: 90}).then(verify204);
      });
      it('should set the hue/sat to light blue', function() {
        return _nanoLeaf.executeCommand({hue: 240, sat: 50}).then(verify204);
      });
      it('should set the hue/sat to very light blue', function() {
        return _nanoLeaf.executeCommand({hue: 240, sat: 10}).then(verify204);
      });
    });

    describe('invalidCommand', function() {
      it('should fail with invalid command', function() {
        return _nanoLeaf.executeCommand({fred: 'flintstone'})
        .catch(function(err) {
          assert.equal(err.message, 'unknown_command');
        });
      });
    });
  });

  describe('NanoLeaf Status', function() {
    it('state object should be complete', function() {
      assert.isNotEmpty(_state);
      assert.containsAllKeys(_state, ['effects', 'state', 'model', 'name']);
      assert.propertyVal(_state, 'model', 'NL22');
      assert.closeTo(_stateChangedCount, _expectedStateCount, 4);
    });
  });

  after(function() {
    return _nanoLeaf.executeCommand({brightness: 20})
      .then(function() {
        return _nanoLeaf.executeCommand({effect: 'Pete1'});      
      });
  });
});
