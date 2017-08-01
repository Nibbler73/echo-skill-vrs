#
#
REGION=eu-west-1
FUNCTION=VrsLookup
#
#
install: zip
	aws lambda update-function-code --function-name $(FUNCTION) --region $(REGION) --zip-file fileb://Lambda.zip

zip:
	zip -u -r Lambda.zip index.js vrsApi.pem package.json node_modules --exclude=node_modules/aws-sdk* --exclude=node_modules/lodash*
