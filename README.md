# update-electron-app

## Why forked?
The original version has 2 unresonable restrictions:

### The update source uri must be https
For people who use Firebase Storage Emulator to test app-update behavior, without turning the emulator to https,
they simply can't integrate update-electron-app.

The first restriction only makes more sense if it's in the non-development env. 

### The app must be packaged
Choosing update-electron-app typically means one use Electron Forge, not Electron Builder.

The former allows user to test 2 app-update behaviors in using dev runtime when properly configured: update-checking and update-downloading. The later allows user to test one more behavior: update-downloaded.

Dev runtime typically means the app serving from dev server, and the biggest reason to test app-update in this env is almost always fast prototyping.

Dev runtime is not a packaged app, however, but that is the requirement from the original update-electron-app, which doesn't make sense.

## That's?
I only remove those 2 restrictions and that's it.
