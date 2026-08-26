# Focus Zen Black

Focus Zen Black is a separate adaptation of Focus Zen Mode 1.1.2 for focused Markdown writing in Obsidian.

## Features

- Hides the ribbon, sidebars, tabs, view header, status bar, and other editor panes.
- Keeps the current Markdown editing line vertically centered.
- Dims non-active lines with adjustable opacity.
- Uses a pure black (`#000000`) background while Zen mode is active.
- Preserves the text, link, heading, code, and formatting colors supplied by the active Obsidian theme.
- Exits Zen mode with `Esc`.
- Registers separate `Toggle`, `Enter`, and `Exit` commands.

## Installation

1. Extract the archive.
2. Copy the `focus-zen-black` folder to:

   ```text
   <vault>/.obsidian/plugins/
   ```

3. Restart Obsidian.
4. Open `Settings > Community plugins` and enable `Focus Zen Black`.

## Keyboard shortcut

The plugin uses Obsidian's standard hotkey manager:

1. Open `Settings > Hotkeys`.
2. Search for `Focus Zen Black`.
3. Assign a shortcut to `Toggle zen mode`.

You can also assign separate shortcuts to `Enter zen mode` and `Exit zen mode`.

## Settings

`Keyboard shortcut` opens Obsidian's standard hotkey manager for the plugin commands.

`Unfocused text opacity` controls the opacity of all lines except the active line.

Version 1.0.1 removes active-line side bands and hides the editor scrollbar while focus mode is active.

## License and origin

Based on Focus Zen Mode 1.1.2 by Red (FoxMaySay), licensed under the MIT License.
The black-background adaptation preserves the original license in `LICENSE`.
