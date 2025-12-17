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
type Sensor = {
  id: number;
  group_ID?: string;
  recorded_at: string;
};

type Args = {
  users: string;
  groups: string;
  sensors: string;
  port: number;
  interval: number;
  publicGroups: number[];
  protected: string[];
  public: string[];
};

const sensorRegex = /sensor-(\d+)/;
const groupRegex = /group-(\d+)/;
export class AclEndpoint extends Processor<Args> {
  foundGroups: Groups = {};
  sensorGroups: { [id: string]: { date: Date; id: string } } = {};
  foundUsers: User[] = [];

  private getGroupId(
    this: Args & this,
    identifier: string,
  ): number | undefined {
    const groupMatch = identifier.match(groupRegex);
    if (groupMatch) {
      let groupId: number | undefined = parseInt(groupMatch[1]!); // "2"
      console.log("Found group id", groupId);
      if (groupId) return groupId;
    }

    const sensorMatch = identifier.match(sensorRegex);
    if (sensorMatch) {
      let sensorId: string = sensorMatch[1] || ""; // "2"
      console.log(
        "Found sensor id",
        sensorId,
        "with group",
        this.sensorGroups[sensorId]?.id,
      );
      const groupId = this.sensorGroups[sensorId]?.id;
      if (groupId) return parseInt(groupId);
    }
    return;
  }

  private async fetchGroups(this: Args & this) {
    const resp = await fetch(this.groups);
    const groups = <Data<Group>>await resp.json();

    this.foundGroups = {};
    for (const g of groups.history) {
      this.foundGroups[g.id + ""] = g;
    }
  }

  private async fetchSensors(this: Args & this) {
    console.log("HELLOA");
    const resp = await fetch(this.sensors);
    const groups = <Data<Sensor>>await resp.json();

    for (const g of groups.history) {
      const date = new Date(g.recorded_at);
      if (
        this.sensorGroups[g.id] == undefined ||
        this.sensorGroups[g.id]!.date < date
      ) {
        delete this.sensorGroups[g.id];
        if (g.group_ID) {
          this.sensorGroups[g.id] = {
            date,
            id: g.group_ID,
          };
        }
      }
    }
    console.log(JSON.stringify(this.sensorGroups));
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
    this.sensors = this.sensors ?? "http://localhost:8080/history.php?sensors";

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

          let groupId = this.getGroupId(identifier);
          if (groupId !== undefined) {
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
      try {
        await this.fetchGroups();
        await this.fetchUsers();
        await this.fetchSensors();
        console.log("FETCH SUCCESFUL!");
      } catch (ex) {
        // pass
      }
    }, this.interval);
  }

  async produce(this: Args & this): Promise<void> {}
}
