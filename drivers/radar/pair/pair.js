/* eslint-disable prefer-destructuring */
/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */

const homeyIsV2 = typeof Homey.showLoadingOverlay === 'function';
Homey.setTitle(__('pair.title'));

// Hide APIKey by default; it will be shown based on radar selection
$('#APIKey').prop('disabled', true);
$('#APIKey').hide();
$('#APIKeyLabel').hide();

function authMethodSelected() {
  const authMethod = $('#authMethod').val();
  if (authMethod === 'oauth2') {
    $('#oauthFields').show();
    $('#basicFields').hide();
  } else {
    $('#oauthFields').hide();
    $('#basicFields').show();
  }
}

function radarSelected() {
  const selectedRadar = $('#radarSelection').val();

  if (selectedRadar === 'openSky') {
    // Show credentials fields for OpenSky
    $('#credentialsContainer').show();
    authMethodSelected();
    // Hide APIKey for OpenSky
    $('#APIKey').prop('disabled', true);
    $('#APIKey').hide();
    $('#APIKeyLabel').hide();
  } else if (selectedRadar === 'adsbExchangePaid') {
    // Hide credentials fields for adsbExchangePaid
    $('#credentialsContainer').hide();
    $('#username').val('');
    $('#password').val('');
    $('#fallbackOwnData').prop('checked', false);
    $('#feederSerial').val('');
    $('#clientId').val('');
    $('#clientSecret').val('');
    $('#authMethod').val('oauth2');
    authMethodSelected();
    // Show APIKey for adsbExchangePaid
    $('#APIKey').prop('disabled', false);
    $('#APIKey').show();
    $('#APIKeyLabel').show();
  } else {
    // Default to hiding all optional fields
    $('#credentialsContainer').hide();
    $('#username').val('');
    $('#password').val('');
    $('#fallbackOwnData').prop('checked', false);
    $('#feederSerial').val('');
    $('#clientId').val('');
    $('#clientSecret').val('');
    $('#authMethod').val('oauth2');
    authMethodSelected();
    $('#APIKey').prop('disabled', true);
    $('#APIKey').hide();
    $('#APIKeyLabel').hide();
  }
}

// Call radarSelected() when the document is ready
$(document).ready(function() {
  radarSelected();
  authMethodSelected();
});

function testSettings() {
  const data = {
    radarSelection: $('#radarSelection').val(),
    authMethod: $('#authMethod').val(),
    username: $('#username').val(),
    password: $('#password').val(),
    clientId: $('#clientId').val(),
    clientSecret: $('#clientSecret').val(),
    fallbackOwnData: $('#fallbackOwnData').is(':checked'),
    feederSerial: $('#feederSerial').val(),
    APIKey: $('#APIKey').val(),
  };

  if (data.radarSelection === 'openSky') {
    if (data.authMethod === 'oauth2' && (!data.clientId || !data.clientSecret)) {
      Homey.alert(__('pair.oauthMissing'), 'error');
      return;
    }
    if (data.authMethod === 'basic' && (!data.username || !data.password)) {
      Homey.alert(__('pair.basicMissing'), 'error');
      return;
    }
  }
  
  const trackIDSelection = $('#trackIDSelection').val();
  const trackID = $('#trackID').val();
  data[trackIDSelection] = trackID;

  if (data.radarSelection !== 'openSky') {
    delete data.username;
    delete data.password;
    delete data.clientId;
    delete data.clientSecret;
    delete data.authMethod;
    delete data.fallbackOwnData;
    delete data.feederSerial;
  }

  // Continue to back-end, pass along data
  Homey.emit('validate', data, (error, result) => {
    if (error) {
      Homey.alert(error.message, 'error');
    } else {
      Homey.alert(`${__('pair.success')} ${result}`, 'info');
      const device = result; // Assuming radar_driver.js now returns a JS object
      Homey.addDevice(device, (err, res) => {
        if (err) { Homey.alert(err, 'error'); return; }
        setTimeout(() => {
          Homey.done();
        }, 2000);
      });
    }
  });
}
