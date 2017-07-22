// https://github.com/Nibbler73/echo-skill-vrs/index.js

// There are three sections, Text Strings, Skill Code, and Helper Function(s).
// You can copy and paste the entire file contents as the code for a new Lambda function,
//  or copy & paste section #3, the helper function, to the bottom of your existing Lambda code.

// TODO:
// - Confirm Save
// - Help Should emit Back to initial Intent (Continue Dialog)
// - Add propper Timezone to JS Date objects

// 1. Text strings =====================================================================================================
//    Modify these strings and messages to change the behavior of your Lambda function

var limitToLine = 0;
var currentIntentSlot;
var helpSlotHelp = {
    'STATION': 'Sage mir den Namen der Station, zu der Du die Abfahrtszeiten hören möchtest.',
    'LINIE': 'Sage mir die Linit, zu der Du die Abfahrtszeiten hören möchtest.',
}
// TODO: This is for the Testing-Service only
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";


// 2. Skill Code =======================================================================================================

var Alexa = require('alexa-sdk');

exports.handler = function(event, context, callback) {
    var alexa = Alexa.handler(event, context);

    alexa.appId = process.env.APP_ID;
    alexa.dynamoDBTableName = 'VrsUserAttributes';  // Store user-attributes in DynamoDB (creates new table for session.attributes)

    alexa.registerHandlers(handlers);
    alexa.execute();
};

var handlers = {
    'LaunchRequest': function () {
        this.emit('ListStationsIntent');
    },

    /*
     *
     */
    'TestIntent': function () {
        this.emit('ListStationsIntent');
    },

    /*
     *
     */
    'ListStationsIntent': function () {

        var defaultStationId = this.attributes['DefaultStationId'];
        if(undefined !== defaultStationId) {
			// Track usage
            var currentTime = Math.round(new Date().getTime() / 1000);
            this.attributes['UsageLastUsageTime'] = currentTime;
            if(undefined === this.attributes['UsageCount']) {
                this.attributes['UsageCount'] = 0;
            }
            this.attributes['UsageCount'] += 1;
            loadDeparturesForStation(defaultStationId,  (data) => {
                var speech = 'Linie ';
                var separator = '';
                var lineCounter=0;
                var stopEventList = data.Trias.ServiceDelivery[0].DeliveryPayload[0].StopEventResponse[0].StopEventResult;
                if(stopEventList instanceof Array) {
                    stopEventList.forEach(function(stopEvent) {
                        var line = stopEvent.StopEvent[0].Service[0].PublishedLineName[0].Text[0];
                        var direction = stopEvent.StopEvent[0].Service[0].DestinationText[0].Text[0];
                        var ServiceDeparture = stopEvent.StopEvent[0].ThisCall[0].CallAtStop[0].ServiceDeparture[0];
                        var estimatedTimeString = ServiceDeparture.TimetabledTime[0];
                        if(undefined !== ServiceDeparture.EstimatedTime) {
                            estimatedTimeString = ServiceDeparture.EstimatedTime[0];
                        }
                        var estimatedTime = new Date(estimatedTimeString);
    				    // Calculate minutes till departure
                        var minutes = Math.round( (estimatedTime.getTime() / 1000 - currentTime) / 60 );
        				if (minutes >= 0 && ( limitToLine===0 || limitToLine == line )) {
        				    speech += separator + line + ' nach ' + direction + (minutes < 1 ? ' sofort' : ' in ' + minutes + ' Min.');
        				    separator = ', ';
        				    lineCounter++;
        				}
        			});
        			if(lineCounter===0) {
        			    speech = 'In der kommenden Stunde fahren keine Bahnen oder Busse.';
        			    if(limitToLine>0) {
        			        speech += ' Beschränkung auf Linie ' + limitToLine;
        			    }
        			}
                } else {
                    speech = 'Zu Haltestelle ' + this.attributes['DefaultStationName'] + ' kann ich keine Abfahrten finden.';
                }
    			var definedStationTimeDelta = currentTime - this.attributes['DefaultStationDefinitionTime'];
    			if(definedStationTimeDelta < 100) {
    			    // Prefix station name before lines, as is't a freshly changed station
    			    speech = 'Abfahrten von ' + this.attributes['DefaultStationName'] + ': ' + speech;
    			} else {
    			    speech = speech + '. Das waren Abfahrten von ' + this.attributes['DefaultStationName'];
    			}

                this.emit(':tell', speech );
    
            } );
        } else {
            this.emit('ConfigureStationIntent');
        }

    },


    /*
     *
     */
    'ConfirmSaveIntent': function () {
        this.emit(':saveState', true);

        // New Station is saved, now list it's departures
        this.emit('ListStationsIntent');
    },
    'ConfigureStationIntent': function () {
        if (this.event.request.dialogState === 'STARTED') {
            // Indicate requested slot to HelpIntent
            currentIntentSlot = 'STATION';
            var updatedIntent = this.event.request.intent;
            // Pre-fill slots: update the intent object with slot values for which
            // you have defaults, then emit :delegate with this updated intent.
            // No Default values: updatedIntent.slots.SlotName.value = 'DefaultValue';
            this.emit(':delegate', updatedIntent);
        } else if (this.event.request.dialogState !== 'COMPLETED'){
            this.emit(':delegate');
        } else {
            // Indicate no slot to HelpIntent
            currentIntentSlot = null;
            // All the slots are filled (And confirmed if you choose to confirm slot/intent)
            // Store Station Name
            var stationName = this.event.request.intent.slots.STATION.value;
            console.log('* StationName: ' + stationName);
            // Lookup Station Name and ID with VRS
            loadStationFromUserInput(stationName, (data) => {
                var canonicalStationId = data.Trias.ServiceDelivery[0].DeliveryPayload[0].LocationInformationResponse[0].Location[0].Location[0].StopPlace[0].StopPlaceRef[0];
                var canonicalStationName = data.Trias.ServiceDelivery[0].DeliveryPayload[0].LocationInformationResponse[0].Location[0].Location[0].LocationName[0].Text[0];
                console.log('** StationId: ' + canonicalStationId);
                console.log('** StationName: ' + canonicalStationName);

                // Write Station session, must still be saved, as the storeEmit happened already when the intent ended; we are in a later callback here
                this.attributes['DefaultStationId'] = canonicalStationId;
                this.attributes['DefaultStationName'] = canonicalStationName;
                this.attributes['DefaultStationDefinitionTime'] = Math.round(new Date().getTime() / 1000);

                //this.emit(':tell', 'Deine Haltestelle lautet: ' + canonicalStationName + '.' );
                // New Station is declared, now save it
                this.emit('ConfirmSaveIntent');
            });

        }
    },
    /*
     *
     */
    'ListLineOfStationIntent': function () {
        if (this.event.request.dialogState === 'STARTED') {
            // Indicate requested slot to HelpIntent
            currentIntentSlot = 'LINIE';
            var updatedIntent = this.event.request.intent;
            this.emit(':delegate', updatedIntent);
        } else if (this.event.request.dialogState !== 'COMPLETED') {
            this.emit(':delegate');
        } else {
            // Indicate no slot to HelpIntent
            currentIntentSlot = null;
            limitToLine = this.event.request.intent.slots.LINIE.value;
            this.emit('ListStationsIntent');
        }
    },

    /*
     *
     */
    'SayStationIntent': function () {
        this.emit(':tell', 'Deine Haltestelle lautet: ' + this.attributes['DefaultStationName'] + '.' );
    },


    /*
     *
     */
    'AMAZON.HelpIntent': function() {
        var help = "Abfahrtspläne für den V.R.S., z.B. die Abfahrten der Haltestellen in Köln. "
                + "Wenn Du Deine Haltestelle ändern möchtest, sage: ich bin umgezogen. "
                + "Wenn Du wissen möchtest, zu welcher Haltestelle ich die Abfahrtzeiten abrufe, sage: wo bist Du? "
                + ""
                + "";
        if(null !== currentIntentSlot) {
            var helpSlot = helpSlotHelp[currentIntentSlot];
            if(undefined !== helpSlot) {
                help = helpSlot;
            }
        }
        this.emit(':ask', help, help);
    },
    /*
     *
     */
    'Unhandled': function() {
        this.emit(':ask', 'Entschuldige, das habe ich nicht verstanden. Probier es mit dem Namen einer Haltestelle bzw. mit der Nummer einer Linie.', 'Probier es mit dem Namen einer Haltestelle oder mit der Nummer eine Bahnlinie.');
    }
};


//    END of Intent Handlers {} ========================================================================================
// 3. Helper Function  =================================================================================================


var https = require('https');

// https is a default part of Node.JS.  Read the developer doc:  https://nodejs.org/api/https.html
// try other APIs such as the current bitcoin price : https://btc-e.com/api/2/btc_usd/ticker  returns ticker.last


// Post the contents of postData as XML and convert the result from XMl to JSON
function httpsPost(postData, callback) {
    // An object of options to indicate where to post to
    var post_options = {
        host: process.env.ENDPOINT_HOST,
        port: process.env.ENDPOINT_PORT,
        path: process.env.ENDPOINT_PATH,
        method: 'POST',
        headers: {
            'Content-Type': 'application/xml',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    var post_req = https.request(post_options, res => {
        res.setEncoding('utf8');
        var returnData = "";

        res.on('data', chunk => {
            console.log('Response: ' + chunk);
            returnData = returnData + chunk;
        });

        res.on('end', () => {
            var parser = new xml2js.Parser();
            parser.parseString(returnData, function (err, result) {
                callback(result);  // this will execute whatever function the caller defined, with one argument
            });

        });

    });

    post_req.on('error', function(e) {
		console.log('problem with request: ' + e.message);
	});
	post_req.on('socket', function (socket) {
		socket.setTimeout(parseInt(process.env.ENDPOINT_TIMEOUT));
		socket.on('timeout', function() {
			post_req.abort();
		});
	});

	// post the data
    post_req.write(postData);
    post_req.end();
}


var fs = require('fs'),
    xml2js = require('xml2js');
const util = require('util');
/*
 * xml2js function wrapper/helper to have convenient access to the XML interface
 *
 */
function testStationFromUserInput(stationName) {
    var parseString = require('xml2js').parseString;
    var xml = '<?xml version="1.0" encoding="UTF-8"?> <Trias version="1.1" xmlns="http://www.vdv.de/trias" xmlns:siri="http://www.siri.org.uk/siri"> <ServiceRequest> <siri:RequestTimestamp>2015-11-09T14:09:00+01:00</siri:RequestTimestamp> <siri:RequestorRef>vrs</siri:RequestorRef> <RequestPayload> <StopEventRequest> <Location> <LocationRef> <StopPlaceRef>de:05315:13411</StopPlaceRef> <LocationName> <Text/> </LocationName> </LocationRef> <DepArrTime>2017-07-21T15:18:40+02:00</DepArrTime> </Location> <Params> <PtModeFilter> <Exclude>false</Exclude> <PtMode>all</PtMode> </PtModeFilter> <TimeWindow>PT1H</TimeWindow> <IncludeRealtimeData>true</IncludeRealtimeData> <NumberOfResults>6</NumberOfResults> </Params> </StopEventRequest> </RequestPayload> </ServiceRequest> </Trias>';
    var resultString = 'no xml';
    parseString(xml, function (err, result) {
        console.log(util.inspect(result, false, null))
        resultString = result;
    });
    return resultString;
}

function loadStationFromUserInput(stationName, callback) {

    var requestStationCanonicalName = {"Trias":{"$":{"version":"1.1","xmlns":"http://www.vdv.de/trias","xmlns:siri":"http://www.siri.org.uk/siri"},"ServiceRequest":[{"RequestPayload":[{"LocationInformationRequest":[{"InitialInput":[{"LocationName":[stationName]}],"Restrictions":[{"NumberOfResults":[2],"Type":["stop"]}]}]}],"siri:RequestTimestamp":["2015-11-09T14:09:00+02:00"],"siri:RequestorRef":["vrs"]}]}};

    var builder = new xml2js.Builder();
    var xml = builder.buildObject(requestStationCanonicalName);

    console.log(xml);
    httpsPost(xml,  (data) => {
                callback(data);
            } );
}

function loadDeparturesForStation(stationId, callback) {

    // "2017-07-21T15:18:40+02:00" CEST
    var currentDate = new Date().toISOString();
    var requestStationDepartures = {"Trias":{"$":{"version":"1.1","xmlns":"http://www.vdv.de/trias","xmlns:siri":"http://www.siri.org.uk/siri"},"ServiceRequest":[{"RequestPayload":[{"StopEventRequest":[{"Location":[{"DepArrTime":[currentDate],"LocationRef":[{"LocationName":[{"Text":[""]}],"StopPlaceRef":[stationId]}]}],"Params":[{"IncludeRealtimeData":[true],"NumberOfResults":[process.env.ENDPOINT_NUMBER_OF_RESULTS],"PtModeFilter":[{"Exclude":[false],"PtMode":["all"]}],"TimeWindow":["PT1H"]}]}]}],"siri:RequestTimestamp":["2015-11-09T14:09:00+01:00"],"siri:RequestorRef":["vrs"]}]}};

    var builder = new xml2js.Builder();
    var xml = builder.buildObject(requestStationDepartures);

    console.log(xml);

    httpsPost(xml,  (data) => {
                callback(data);
            } );

}

/*
 *
 */
function getListOfStationsFromLocationInformationRequest(data) {
    var stopEventList = data.Trias.ServiceDelivery[0].StopEventResponse[0].StopEventResult;
}