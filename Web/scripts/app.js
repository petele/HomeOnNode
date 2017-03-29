window.app = {};
app.lastInput = Date.now();
app.fbRoot = new Firebase(window.fbURL);
app.fbRoot.authWithCustomToken(window.fbKey, function(err) {
  if (err) {
    app.showToast('Firebase authentication error.');
    console.error('Firebase Auth Error', err);
    return;
  }
  app.fbRoot.child('.info/connected').on('value', function(snapshot) {
    if (snapshot.val() === true) {
      app.showToast('Connected to HomeOnNode');
    } else {
      app.showToast('ERROR: Connection to HomeOnNode lost.');
    }
  });
  setInterval(() => {
    app.fbRoot.child('monitor/webClients/heartbeat').set(Date.now());
  }, 3 * 60 * 1000);
});
app.sendCommand = function(cmd) {
  app.lastInput = Date.now();
  console.log('[sendCommand]', cmd);
  app.fbRoot.child('commands').push(cmd, function(err) {
    if (err) {
      console.error('[sendCommand]', cmd, err);
      app.showToast(err.message);
    }
  });
};
app.sortByName = function(a, b) {
  if (a.name < b.name) {
    return -1;
  } else if (a.name > b.name) {
    return 1;
  }
  return 0;
};
app.showToast = function(text) {
  if (app.$ && app.$.toast) {
    app.$.toast.text = text;
    app.$.toast.show();
  }
};
