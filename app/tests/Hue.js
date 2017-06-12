'use strict';

const helpers = require('./helpers');
const assert = require('../node_modules/chai').assert;
const Keys = require('../Keys').keys;

helpers.setBasicLogging();

describe('Hue', function() {
  let _Hue;
  let _hue;

  const CONFIG_KEYS = [
    'apiversion', 'bridgeid', 'ipaddress', 'localtime', 'mac', 'modelid',
    'name', 'netmask', 'portalstate', 'proxyaddress', 'swupdate', 'swversion'
  ];

  const WAIT_FOR_READY = 5 * 1000;
  const TEST_TIMEOUT = WAIT_FOR_READY + WAIT_FOR_UPDATE_TICKS + (5 * 60 * 1000);
  this.timeout(TEST_TIMEOUT);

  const _validLightCommand = {
    on: true,
    alert: 'lselect',
    bri: 254,
    hue: 0,
    sat: 180,
  };
  const _invalidLightCommand = {
    on: true,
    hue: 'string',
  };
  const _expectedConfigCount = 1;
  const _expectedLightsCount = 18;
  const _expectedGroupsCount = 18;

  let _config = {};
  let _lights = {};
  let _groups = {};
  let _configChangedCount = 0;
  let _lightsChangedCount = 0;
  let _groupsChangedCount = 0;

  before(function() {
    _Hue = require('../Hue');
    _hue = new _Hue(Keys.hueBridge.key);
    _hue.on('config_changed', function(config) {
      _configChangedCount++;
      _config = config;
    });
    _hue.on('lights_changed', function(lights) {
      _lightsChangedCount++;
      _lights = lights;
    });
    _hue.on('groups_changed', function(groups) {
      _groupsChangedCount++;
      _groups = groups;
    });
    return helpers.sleep(WAIT_FOR_READY);
  });

  afterEach(function() {
    return helpers.sleep(7500)
      .then(function() {
        return _hue.setLights(0, {on: false});
      });
  });

  function verify(respBody, value) {
    assert.isNotNull(respBody, 'No response body');
    respBody.forEach(function(resp) {
      if (Array.isArray(resp)) {
        resp.forEach(function(r) {
          assert.property(r, value);
        });
        return;
      }
      assert.property(resp, value);
    });
  }

  function verifySuccess(respBody) {
    verify(respBody, 'success');
  }

  function verifyError(respBody) {
    verify(respBody, 'error');
  }

  describe('- is the API ready?', function() {
    it('should turn all lights off', function() {
      return _hue.setLights(0, {on: false});
    });
  });

  describe('#setScene()', function() {
    it('should set lights to a specific scene', function() {
      return _hue.setScene('T1QMNzB2FmelHA2').then(verifySuccess);
    });
    it('should handle invalid scene id', function() {
      return _hue.setScene('not-a-valid-scene')
        .then(function(resp) {
          assert.isNotNull(resp, 'No response body');
          assert.property(resp[0], 'error');
        });
    });
  });

  describe('#setLights()', function() {
    describe('lights', function() {
      it('should handle: valid light/valid state', function() {
        return _hue.setLights(1, _validLightCommand).then(verifySuccess);
      });
      it('should handle: invalid light/valid state', function() {
        return _hue.setLights(99, _validLightCommand).then(verifyError);
      });
      it('should handle: valid light/invalid state', function() {
        return _hue.setLights(1, _invalidLightCommand).then(verifyError);
      });
      it('should handle: invalid light/invalid state', function() {
        return _hue.setLights(999, _invalidLightCommand).then(verifyError);
      });
      it('should set the state of an array of single lights', function() {
        return _hue.setLights([1, 2, 3], _validLightCommand).then(verifySuccess);
      });
    });
    describe('groups', function() {
      it('should handle: valid group/valid state', function() {
        return _hue.setLights(-1, _validLightCommand).then(verifySuccess);
      });
      it('should handle: invalid group/valid state', function() {
        return _hue.setLights(-99, _validLightCommand).then(verifyError);
      });
      it('should handle: valid group/invalid state', function() {
        return _hue.setLights(-1, _invalidLightCommand).then(verifyError);
      });
      it('should handle: invalid group/invalid state', function() {
        return _hue.setLights(-999, _invalidLightCommand).then(verifyError);
      });
      it('should set the state of an array of groups', function() {
        return _hue.setLights([-1, -2], _validLightCommand).then(verifySuccess);
      });
    });
    describe('all lights', function() {
      it('should handle: valid group/valid state', function() {
        return _hue.setLights(0, _validLightCommand).then(verifySuccess);
      });
    });
  });

  describe('Hue Status', function() {
    it('should have data for config, lights and groups', function() {
      assert.isNotEmpty(_config);
      assert.containsAllKeys(_config, CONFIG_KEYS);
      assert.closeTo(_lightsChangedCount, _expectedLightsCount, 4);
      assert.isNotEmpty(_lights);
      assert.closeTo(_lightsChangedCount, _expectedLightsCount, 4);
      assert.isNotEmpty(_groups);
      assert.closeTo(_groupsChangedCount, _expectedLightsCount, 4);
    });
  });

  after(function() {
    return _hue.setScene('uR9E4wuZ8dCZYCj');
  });
});
