/* eslint-disable prefer-destructuring */
/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */

const homeyIsV2 = typeof Homey.showLoadingOverlay === 'function';
Homey.setTitle(__('pair.title'));

// if (!homeyIsV2) {
// 	Homey.showLoadingOverlay = () => {
// 		$('#discover').prop('disabled', true);
// 		$('#runTest').prop('disabled', true);
// 	};
// 	Homey.hideLoadingOverlay = () => {
// 		$('#discover').prop('disabled', false);
// 		$('#runTest').prop('disabled', false);
// 	};
// }

$('#APIKey').prop('disabled', true);
$('#APIKey').hide();
$('#APIKeyLabel').hide();

function authMethodSelected() {
	if ($('#authMethod').val() === 'oauth2') {
		$('#oauthFields').show();
		$('#basicFields').hide();
	} else {
		$('#oauthFields').hide();
		$('#basicFields').show();
	}
}

function radarSelected() {

	if ($('#radarSelection').val() === 'openSky') {
        // Show credentials fields for OpenSky
        $('#credentialsContainer').show();
		authMethodSelected();
    } else {
        // Hide credentials fields for other radars
        $('#credentialsContainer').hide();
        $('#username').val('');
        $('#password').val('');
		$('#clientId').val('');
		$('#clientSecret').val('');
		$('#authMethod').val('oauth2');
		authMethodSelected();
    }

	if ($('#radarSelection').val() === 'openSky') {
		$('#APIKey').prop('disabled', true);
		$('#APIKey').hide();
		$('#APIKeyLabel').hide();
	} else {
		$('#APIKey').prop('disabled', false);
		$('#APIKey').show();
		$('#APIKeyLabel').show();
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
		delete data.authMethod;
		delete data.username;
		delete data.password;
		delete data.clientId;
		delete data.clientSecret;
		delete data.fallbackOwnData;
		delete data.feederSerial;
	}

	// Continue to back-end, pass along data
	Homey.emit('validate', data, (error, result) => {
		if (error) {
			Homey.alert(error.message, 'error');
		} else {
			const device = typeof result === 'string' ? JSON.parse(result) : result;
			const deviceName = device && device.name ? ` ${device.name}` : '';
			Homey.alert(`${__('pair.success')}${deviceName}`, 'info');
			Homey.addDevice(device, (err, res) => {
				if (err) { Homey.alert(err, 'error'); return; }
				setTimeout(() => {
					Homey.done();
				}, 2000);
			});
		}
	});

}
