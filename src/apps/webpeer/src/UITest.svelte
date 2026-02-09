<script lang="ts">
    import { Menu } from "@/lib/src/services/implements/browser/Menu";
    import { getDialogContext } from "@lib/services/implements/base/SvelteDialog";
    let result = $state<string | boolean>("");

    const context = getDialogContext();

    async function testUI() {
        const confirm = await context.services.confirm;
        const ret = await confirm.askString("Your name", "What is your name?", "John Doe", false);
        result = ret;
    }
    let resultPassword = $state<string | boolean>("");
    async function testPassword() {
        const confirm = await context.services.confirm;
        const ret = await confirm.askString("passphrase", "?", "anythingonlyyouknow", true);
        resultPassword = ret;
    }

    async function testMenu(event: MouseEvent) {
        const m = new Menu()
            .addItem((item) => item.setTitle("📥 Only Fetch").onClick(() => {}))
            .addItem((item) => item.setTitle("📤 Only Send").onClick(() => {}))
            .addSeparator()
            .addItem((item) => {
                item.setTitle("🔧 Get Configuration").onClick(async () => {
                    console.log("Get Configuration");
                });
            })
            .addSeparator()
            .addItem((item) => {
                const mark = "checkmark";
                item.setTitle("Toggle Sync on connect")
                    .onClick(async () => {
                        console.log("Toggle Sync on connect");
                        // await this.toggleProp(peer, "syncOnConnect");
                    })
                    .setIcon(mark);
            })
            .addItem((item) => {
                const mark = null;
                item.setTitle("Toggle Watch on connect")
                    .onClick(async () => {
                        console.log("Toggle Watch on connect");
                        // await this.toggleProp(peer, "watchOnConnect");
                    })
                    .setIcon(mark);
            })
            .addItem((item) => {
                const mark = null;
                item.setTitle("Toggle Sync on `Replicate now` command")
                    .onClick(async () => {})
                    .setIcon(mark);
            });
        m.showAtPosition({ x: event.x, y: event.y });
    }
</script>

<main>
    <h1>UI Test</h1>
    <article>
        <div>
            <button onclick={() => testUI()}> String input </button>
            → {result}
        </div>
        <div>
            <button onclick={() => testPassword()}> Password Input </button>
            → {resultPassword}
        </div>
        <div>
            <button onclick={testMenu}>Menu</button>
        </div>
    </article>
</main>
