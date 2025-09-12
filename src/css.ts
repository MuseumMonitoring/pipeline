import { Processor } from "@rdfc/js-runner";
import { App, AppRunner } from "@solid/community-server";


type Args = {
    config: string,
    path: string,
    mainModulePath: string,
}

export class Css extends Processor<Args> {
    private app: App | undefined;
    async init(this: Args & this): Promise<void> {
    }

    async transform(this: Args & this): Promise<void> {
        this.logger.debug("Creating app")
        this.app = await new AppRunner().create(
            {
                // For testing we created a custom configuration that runs the server in memory so nothing gets written on disk.
                config: this.config.substring(7),
                loaderProperties: {
                    // Tell Components.js where to start looking for component configurations.
                    // We need to make sure it finds the components we made in our project
                    // so this needs to point to the root directory of our project.
                    mainModulePath: this.mainModulePath.substring(7),
                    // We don't want Components.js to create an error dump in case something goes wrong with our test.
                    dumpErrorState: false,
                },
                // We do not use any custom Components.js variable bindings and set our values through the CLI options below.
                // Note that this parameter is optional, so you can just drop it.
                variableBindings: {
                    'urn:solid-server:default:variable:rootFilePath': this.path.substring(7)
                }
            }
        );
        this.logger.debug("Starting app")
        await this.app!.start();
        this.logger.info("App started")
    }
    async produce(this: Args & this): Promise<void> {
        // Nothing
    }
}
