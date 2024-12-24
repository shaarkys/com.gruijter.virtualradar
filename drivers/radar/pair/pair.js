/* eslint-disable prefer-destructuring */
/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */

const homeyIsV2 = typeof Homey.showLoadingOverlay === 'function';
Homey.setTitle(__('pair.title'));

// Hide APIKey by default; it will be shown based on radar selection
$('#APIKey').prop('disabled', true);
$('#APIKey').hide();
$('#APIKeyLabel').hide();

function radarSelected() {
  const selectedRadar = $('#radarSelection').val();

  if (selectedRadar === 'openSky') {
    // Show credentials fields for OpenSky
    $('#credentialsContainer').show();
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
    $('#APIKey').prop('disabled', true);
    $('#APIKey').hide();
    $('#APIKeyLabel').hide();
  }
}

// Call radarSelected() when the document is ready
$(document).ready(function() {
  radarSelected();
});

function testSettings() {
  const data = {
    radarSelection: $('#radarSelection').val(),
    username: $('#username').val(),
    password: $('#password').val(),
    fallbackOwnData: $('#fallbackOwnData').is(':checked'),
    feederSerial: $('#feederSerial').val(),
    APIKey: $('#APIKey').val(),
  };
  
  const trackIDSelection = $('#trackIDSelection').val();
  const trackID = $('#trackID').val();
  data[trackIDSelection] = trackID;

  // Remove feederSerial and related fields if not using openSky
  if (data.radarSelection !== 'openSky') {
    delete data.username;
    delete data.password;
    delete data.fallbackOwnData;
    delete data.feederSerial;
  }

  // Remove username and password if not using openSky
  if (data.radarSelection !== 'openSky') {
    delete data.username;
    delete data.password;
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
