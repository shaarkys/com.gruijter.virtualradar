const Homey = require('homey');

module.exports = [
  {
    description: 'Show loglines',
    method: 'GET',
    path: '/getlogs/',
    requires_authorization: true,
    role: 'owner',
    fn: async function (args) {
      try {
        const result = await Homey.app.getLogs();
        return result;  // Resolves the promise and returns the result
      } catch (error) {
        throw error;  // Rejects the promise with the error
      }
    },
  },
  {
    description: 'Delete logs',
    method: 'GET',
    path: '/deletelogs/',
    requires_authorization: true,
    role: 'owner',
    fn: async function (args) {
      try {
        const result = await Homey.app.deleteLogs();
        return result;  // Resolves the promise and returns the result
      } catch (error) {
        throw error;  // Rejects the promise with the error
      }
    },
  },
];
