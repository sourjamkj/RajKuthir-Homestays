// Adds what push needs at build time, only when it is there:
//  - google-services.json (from the owner's Firebase project) next to this file;
//  - EXPO_PROJECT_ID, the Expo project that holds the FCM V1 key.
// Without them the app still builds; Settings → This phone says push is not set up.
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  const firebase = path.join(__dirname, 'google-services.json');
  if (fs.existsSync(firebase)) config.android = { ...config.android, googleServicesFile: './google-services.json' };
  const projectId = process.env.EXPO_PROJECT_ID;
  if (projectId) config.extra = { ...config.extra, eas: { projectId } };
  return config;
};
