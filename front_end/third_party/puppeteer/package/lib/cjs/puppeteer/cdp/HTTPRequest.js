"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CdpHTTPRequest = void 0;
const HTTPRequest_js_1 = require("../api/HTTPRequest.js");
const util_js_1 = require("../common/util.js");
const encoding_js_1 = require("../util/encoding.js");
/**
 * @internal
 */
class CdpHTTPRequest extends HTTPRequest_js_1.HTTPRequest {
    id;
    #client;
    #isNavigationRequest;
    #url;
    #resourceType;
    #method;
    #hasPostData = false;
    #postData;
    #headers = {};
    #frame;
    #initiator;
    get client() {
        return this.#client;
    }
    set client(newClient) {
        this.#client = newClient;
    }
    constructor(client, frame, interceptionId, allowInterception, data, redirectChain) {
        super();
        this.#client = client;
        this.id = data.requestId;
        this.#isNavigationRequest =
            data.requestId === data.loaderId && data.type === 'Document';
        this._interceptionId = interceptionId;
        this.#url = data.request.url + (data.request.urlFragment ?? '');
        this.#resourceType = (data.type || 'other').toLowerCase();
        this.#method = data.request.method;
        this.#postData = data.request.postData;
        this.#hasPostData = data.request.hasPostData ?? false;
        this.#frame = frame;
        this._redirectChain = redirectChain;
        this.#initiator = data.initiator;
        this.interception.enabled = allowInterception;
        for (const [key, value] of Object.entries(data.request.headers)) {
            this.#headers[key.toLowerCase()] = value;
        }
    }
    url() {
        return this.#url;
    }
    resourceType() {
        return this.#resourceType;
    }
    method() {
        return this.#method;
    }
    postData() {
        return this.#postData;
    }
    hasPostData() {
        return this.#hasPostData;
    }
    async fetchPostData() {
        try {
            const result = await this.#client.send('Network.getRequestPostData', {
                requestId: this.id,
            });
            return result.postData;
        }
        catch (err) {
            (0, util_js_1.debugError)(err);
            return;
        }
    }
    headers() {
        return this.#headers;
    }
    response() {
        return this._response;
    }
    frame() {
        return this.#frame;
    }
    isNavigationRequest() {
        return this.#isNavigationRequest;
    }
    initiator() {
        return this.#initiator;
    }
    redirectChain() {
        return this._redirectChain.slice();
    }
    failure() {
        if (!this._failureText) {
            return null;
        }
        return {
            errorText: this._failureText,
        };
    }
    /**
     * @internal
     */
    async _continue(overrides = {}) {
        const { url, method, postData, headers } = overrides;
        this.interception.handled = true;
        const postDataBinaryBase64 = postData
            ? (0, encoding_js_1.stringToBase64)(postData)
            : undefined;
        if (this._interceptionId === undefined) {
            throw new Error('HTTPRequest is missing _interceptionId needed for Fetch.continueRequest');
        }
        await this.#client
            .send('Fetch.continueRequest', {
            requestId: this._interceptionId,
            url,
            method,
            postData: postDataBinaryBase64,
            headers: headers ? (0, HTTPRequest_js_1.headersArray)(headers) : undefined,
        })
            .catch(error => {
            this.interception.handled = false;
            return (0, HTTPRequest_js_1.handleError)(error);
        });
    }
    async _respond(response) {
        this.interception.handled = true;
        let parsedBody;
        if (response.body) {
            parsedBody = HTTPRequest_js_1.HTTPRequest.getResponse(response.body);
        }
        const responseHeaders = {};
        if (response.headers) {
            for (const header of Object.keys(response.headers)) {
                const value = response.headers[header];
                responseHeaders[header.toLowerCase()] = Array.isArray(value)
                    ? value.map(item => {
                        return String(item);
                    })
                    : String(value);
            }
        }
        if (response.contentType) {
            responseHeaders['content-type'] = response.contentType;
        }
        if (parsedBody?.contentLength && !('content-length' in responseHeaders)) {
            responseHeaders['content-length'] = String(parsedBody.contentLength);
        }
        const status = response.status || 200;
        if (this._interceptionId === undefined) {
            throw new Error('HTTPRequest is missing _interceptionId needed for Fetch.fulfillRequest');
        }
        await this.#client
            .send('Fetch.fulfillRequest', {
            requestId: this._interceptionId,
            responseCode: status,
            responsePhrase: HTTPRequest_js_1.STATUS_TEXTS[status],
            responseHeaders: (0, HTTPRequest_js_1.headersArray)(responseHeaders),
            body: parsedBody?.base64,
        })
            .catch(error => {
            this.interception.handled = false;
            return (0, HTTPRequest_js_1.handleError)(error);
        });
    }
    async _abort(errorReason) {
        this.interception.handled = true;
        if (this._interceptionId === undefined) {
            throw new Error('HTTPRequest is missing _interceptionId needed for Fetch.failRequest');
        }
        await this.#client
            .send('Fetch.failRequest', {
            requestId: this._interceptionId,
            errorReason: errorReason || 'Failed',
        })
            .catch(HTTPRequest_js_1.handleError);
    }
}
exports.CdpHTTPRequest = CdpHTTPRequest;
//# sourceMappingURL=HTTPRequest.js.map