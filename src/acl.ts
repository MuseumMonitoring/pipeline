import { Processor } from "@rdfc/js-runner";
import { Data } from "./fetch";
import * as http from "http";

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

function publicString(): string {
  return `
@prefix foaf: <http://xmlns.com/foaf/0.1/>.
@prefix acl: <http://www.w3.org/ns/auth/acl#>.

<#public> a acl:Authorization;
  acl:agentClass foaf:Agent;
  acl:accessTo <./>;
  acl:default <./>;
  acl:mode acl:Read.
`;
}

function emailAuth(email: string, count: number): string {
  return `
@prefix acl: <http://www.w3.org/ns/auth/acl#>.
@prefix foaf: <http://xmlns.com/foaf/0.1/>.

_:b${count}
    a acl:Authorization;
    acl:agent <${email}>;
    acl:accessTo <./>;
    acl:default <./>;
    acl:mode
        acl:Read.
`;
}

type User = {
  email: string;
  group_id?: number;
  web_id?: string;
};

type Group = {
  id: number;
  group_name: string;
  parent?: number;
  url?: string;
};
type Groups = { [id: string]: Group };
type UsersPerGroup = { [id: string]: User[] };

type Args = {
  users: string;
  groups: string;
  port: number;
  interval: number;
  publicGroups: number[];
  protected: string[];
  public: string[];
};

const regex = /sensor-(\d+)/;
export class AclEndpoint extends Processor<Args> {
  foundGroups: Groups = {};
  foundUsers: User[] = [];

  private async fetchGroups(this: Args & this) {
    const resp = await fetch(this.groups);
    const groups = <Data<Group>>await resp.json();

    this.foundGroups = {};
    for (const g of groups.history) {
      this.foundGroups[g.id + ""] = g;
    }
  }

  private async fetchUsers(this: Args & this) {
    const resp = await fetch(this.users);
    const users = <Data<User>>await resp.json();

    this.foundUsers = [];
    for (const u of users.history) {
      if (!u.group_id) {
        u.group_id = 1;
      }
      this.foundUsers.push(u);
    }
  }

  async init(this: Args & this): Promise<void> {
    this.interval = this.interval ?? 1000;
    this.port = this.port ?? 7111;
    this.users = this.users ?? "http://localhost:8080/history.php?users";
    this.groups = this.groups ?? "http://localhost:8080/history.php?groups";

    http
      .createServer(async (request, response) => {
        const body = await readBody(request);
        try {
          const { path } = JSON.parse(body);
          const identifier: string = path;
          const url = new URL(identifier);

          response.writeHead(200);

          console.log(url.pathname);
          let isProtected = false;
          for (const p of this.protected) {
            if (url.pathname.startsWith(p)) {
              isProtected = true;
              this.logger.debug("Protected by " + p);
            } else {
              this.logger.debug("Not protected by " + p);
            }
          }

          let isPublic = false;
          for (const p of this.public) {
            if (url.pathname.startsWith(p)) {
              isPublic = true;
              this.logger.debug("Public by " + p);
            } else {
              this.logger.debug("Not public by " + p);
            }
          }

          if (!isProtected || isPublic) {
            console.log("Not protected or is public", url.pathname);
            await new Promise((res) => response.write(publicString(), res));
          }

          const match = identifier.match(regex);

          if (match) {
            let groupId: number | undefined = parseInt(match[1]!); // "2"

            if (this.publicGroups.includes(groupId)) {
              console.log("Public group", url.pathname);
              await new Promise((res) => response.write(publicString(), res));
            }

            const allowedGroups = new Set();
            while (groupId) {
              allowedGroups.add(groupId);
              groupId = this.foundGroups[groupId]?.parent;
              if (allowedGroups.has(groupId)) break;
            }

            this.logger.debug("allowed groups", JSON.stringify(allowedGroups));
            const users = this.foundUsers.filter((u) =>
              allowedGroups.has(u.group_id),
            );
            let c = 0;
            for (const u of users) {
              await new Promise((res) =>
                // TODO: if there is no web_id, get the generated web_id linked with the email address
                response.write(emailAuth(u.web_id || u.email, c++), res),
              );
            }
            this.logger.debug("allowed users", JSON.stringify(users));
          }

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

  async transform(this: Args & this): Promise<void> {
    console.log({ users: this.users, groups: this.groups });
    setInterval(async () => {
      await this.fetchGroups();
      await this.fetchUsers();
      console.log("FETCH SUCCESFUL!");
    }, this.interval);
  }

  async produce(this: Args & this): Promise<void> {}
}
