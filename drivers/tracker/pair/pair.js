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
	const selectedRadar = $('#radarSelection').val();
	const isOpenSky = selectedRadar === 'openSky';
	const isPaid = selectedRadar === 'adsbExchangePaid';
	const isLocalFeeder = selectedRadar === 'localFeeder';

	$('#credentialsContainer').toggle(isOpenSky);
	$('#localFeederContainer').toggle(isLocalFeeder);
	if (isOpenSky) {
		authMethodSelected();
	}
	$('#APIKey').prop('disabled', !isPaid).toggle(isPaid);
	$('#APIKeyLabel').toggle(isPaid);
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
		localFeederUrl: $('#localFeederUrl').val(),
		localFeederUnits: $('#localFeederUnits').val(),
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
	if (data.radarSelection === 'localFeeder' && !data.localFeederUrl.trim()) {
		Homey.alert(__('pair.localFeederUrlMissing'), 'error');
		return;
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
	if (data.radarSelection !== 'adsbExchangePaid') {
		delete data.APIKey;
	}
	if (data.radarSelection !== 'localFeeder') {
		delete data.localFeederUrl;
		delete data.localFeederUnits;
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
