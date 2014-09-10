/**
 * Listens for the app launching then creates the window
 *
 * @see http://developer.chrome.com/trunk/apps/app.runtime.html
 * @see http://developer.chrome.com/trunk/apps/app.window.html
 */
chrome.app.runtime.onLaunched.addListener(function() {
  // Center window on screen.
  var screenWidth = screen.availWidth;
  var screenHeight = screen.availHeight;
  var width = 350;
  var height = 500;

  chrome.app.window.create('chrome_app/index.html', {
    bounds: {
      width: width,
      height: height
    },
    minHeight: 500,
    minWidth: 300,
    id: 'ca.BigBackpack.PiController0002'
  });
});
