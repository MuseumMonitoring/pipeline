import { Processor } from "@rdfc/js-runner";

import * as DPoP from "dpop";
import * as http from "http";

function base64Encode(str: string) {
  // Browser, Deno, Workers: use btoa
  if (typeof btoa !== "undefined") {
    return btoa(str);
  }

  // Node, Bun: use Buffer
  if (typeof Buffer !== "undefined") {
    return Buffer.from(str, "utf8").toString("base64");
  }

  throw new Error("No base64 encoding available in this environment");
}

type Controls = {
  webId: string;
  pod: string;
  webIdLinks: { [webId: string]: string };
  controls: {
    password: {
      login: string;
      create: string;
    };
    account: {
      create: string;
      webId: string;
      pod: string;
      clientCredentials: string;
    };
    main: {
      index: string;
      logins: string;
    };
  };
  authorization?: string;
};
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      res(body);
    });
  });
}

type RequestInput = {
  email: string;
  password: string;
};

type Args = {
  port: number;
  timeout: number;
  baseUrl: string;
};

class AccountAttempt {
  controls: Controls;
  root: string;
  credentials: { email: string; password: string };
  oidcEndpoint: string;
  authorization?: string;
  webId?: string;
  authToken?: string;

  constructor(
    controls: Controls,
    root: string,
    credentials: { email: string; password: string },
    oidcEndpoint: string,
  ) {
    this.controls = controls;
    this.root = root;
    this.credentials = credentials;
    this.oidcEndpoint = oidcEndpoint;
  }

  async get<T>(
    url: string,
    extra_headers?: { [key: string]: string },
  ): Promise<T> {
    const headers = extra_headers || {};
    if (this.authorization) {
      headers["Authorization"] = "CSS-Account-Token " + this.authorization;
    }

    let req = await fetch(url, {
      method: "GET",
      headers,
      credentials: "same-origin",
    });
    return await req.json();
  }

  async post<T>(
    url: string,
    body: Object,
    extra_headers?: { [key: string]: string },
  ): Promise<T> {
    const headers = Object.assign(
      {
        "content-type": "application/json",
      },
      extra_headers || {},
    );
    if (this.authorization) {
      headers["Authorization"] = "CSS-Account-Token " + this.authorization;
    }
    let req = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
    return await req.json();
  }

  async login() {
    console.log(this.controls.controls.password);
    const loginAttempt: Controls = await this.post(
      this.controls.controls.password.login,
      {
        email: this.credentials.email,
        password: this.credentials.password,
      },
    );
    console.log("FOUND LOGIN ATTAEMPT");
    console.log(loginAttempt);
    if (loginAttempt["authorization"]) {
      console.log("Login succesful!");
      this.authorization = loginAttempt.authorization;
      this.controls = await this.get(loginAttempt.controls.main.index);
    } else {
      throw "Login Failed";
    }
  }

  async createAccount() {
    this.controls = await this.post(this.controls.controls.account.create, {});
    this.authorization = <string>this.controls.authorization;
    this.controls = await this.get(this.root);
    return this.controls;
  }

  async createLogin() {
    const login = await this.post(this.controls.controls.password.create, {
      email: this.credentials.email,
      password: this.credentials.password,
    });
    return login;
  }

  async createToken() {
    const { id, secret } = await this.createClientCredentials();
    const authString = `${encodeURIComponent(id)}:${encodeURIComponent(secret)}`;

    const keypair = await DPoP.generateKeyPair("ES256");
    const proof = await DPoP.generateProof(
      keypair,
      this.oidcEndpoint,
      "POST",
      undefined,
      undefined,
    );

    const response = await fetch(this.oidcEndpoint, {
      method: "POST",
      headers: {
        // The header needs to be in base64 encoding.
        authorization: `Basic ${base64Encode(authString)}`,
        "content-type": "application/x-www-form-urlencoded",
        dpop: proof,
      },
      body: "grant_type=client_credentials&scope=webid",
    });

    const json = await response.json();
    this.authToken = json.access_token;
    return json.access_token;
  }

  async authHeaders() {
    return {
      Authorization: `Bearer ${this.authToken}`,
    };
  }

  async createPod() {
    const pod = `my_pod_${Math.random()}`;
    return this.post(this.controls.controls.account.pod, { name: pod });
  }

  async getWebId() {
    const resp: Controls = await this.get(this.controls.controls.account.webId);
    const ids = Object.keys(resp.webIdLinks);
    if (ids.length > 1) {
      console.error("Didn't expect more than one webId");
    }
    if (ids[0]) {
      this.webId = ids[0];
    }
  }

  async createClientCredentials(): Promise<{ id: string; secret: string }> {
    if (!this.webId) {
      console.log("I'm unsure of my webid");
      await this.getWebId();
    }

    console.log("webid", this.webId);

    const resp = <{ id: string; secret: string }>await this.post(
      this.controls.controls.account.clientCredentials,
      {
        webId: this.webId,
      },
    );

    const json = {
      id: resp.id,
      secret: resp.secret,
      endpoint: this.oidcEndpoint,
      webId: this.webId,
    };

    return json;
  }
}

export class WebIdBuilder extends Processor<Args> {
  controls: Controls = {} as Controls;

  initCb: (c: void) => void = () => {};
  initPromise = new Promise((res) => (this.initCb = res));

  accountRoot: string = "";
  oidcEndpoint: string = "";

  async setupRoot(this: Args & this) {
    console.log("Fetching ", this.accountRoot);
    const controlsRequest = await fetch(this.accountRoot);
    if (!controlsRequest.ok) {
      setTimeout(() => this.setupRoot(), this.timeout ?? 5000);
      return;
    }
    console.log(controlsRequest);
    this.controls = await controlsRequest.json();
    console.log("controls", this.controls);
    this.initCb();
  }

  async init(this: Args & this): Promise<void> {
    this.accountRoot = this.baseUrl + "/.account/";
    this.oidcEndpoint = this.baseUrl + "/.oidc/token";
    setTimeout(() => this.setupRoot(), this.timeout ?? 5000);
  }
  async transform(this: Args & this): Promise<void> {
    http
      .createServer(async (request, response) => {
        await this.initPromise;
        const body = await readBody(request);
        try {
          const credentials = <RequestInput>JSON.parse(body);

          console.log("attempting loging with ", credentials);

          const attempt = new AccountAttempt(
            this.controls,
            this.accountRoot,
            credentials,
            this.oidcEndpoint,
          );

          try {
            await attempt.login();
            console.log("Login succesful");

            console.log(
              await attempt.get(attempt.controls.controls.account.webId),
            );
          } catch (ex) {
            console.log("Login failed", ex);
            await attempt.createAccount();
            await attempt.createLogin();
            await attempt.createPod();
          }

          const output = await attempt.createClientCredentials();
          console.log("HERE", output);

          response.writeHead(200, { "content-type": "application/json" });
          response.write(JSON.stringify(output));

          response.end();
        } catch (ex) {
          this.logger.error("Exception happened " + JSON.stringify(ex));
          response.writeHead(500);
          response.write(ex);
          response.end();
        }
      })
      .listen(this.port, () => {
        this.logger.info("Listening on port " + this.port);
      });
  }

  async produce(this: Args & this): Promise<void> {}
}
