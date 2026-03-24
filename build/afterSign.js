exports.default = async function (context) {
  if (context.electronPlatformName === 'darwin') {
    const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`
    const { execSync } = require('child_process')
    console.log(`  • re-signing ${appPath}`)
    execSync(`codesign --deep --force --sign - "${appPath}"`)
  }
}
