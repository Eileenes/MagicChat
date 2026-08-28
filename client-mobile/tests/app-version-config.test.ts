import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const root = new URL("../", import.meta.url)

test("原生平台版本与 Expo 配置保持一致", async () => {
  const [appConfig, androidGradle, iosProject, iosInfo] = await Promise.all([
    readFile(new URL("app.json", root), "utf8").then(JSON.parse),
    readFile(new URL("android/app/build.gradle", root), "utf8"),
    readFile(new URL("ios/app.xcodeproj/project.pbxproj", root), "utf8"),
    readFile(new URL("ios/app/Info.plist", root), "utf8"),
  ])

  assert.equal(appConfig.expo.version, "1.3.0")
  assert.equal(appConfig.expo.android.versionCode, 9)
  assert.equal(appConfig.expo.ios.buildNumber, "9")
  assert.match(androidGradle, /versionCode 9/)
  assert.match(androidGradle, /versionName "1\.3\.0"/)
  assert.equal(iosProject.match(/CURRENT_PROJECT_VERSION = 9;/g)?.length, 2)
  assert.equal(iosProject.match(/MARKETING_VERSION = 1\.3\.0;/g)?.length, 2)
  assert.match(iosInfo, /<key>CFBundleShortVersionString<\/key>\s*<string>1\.3\.0<\/string>/)
  assert.match(iosInfo, /<key>CFBundleVersion<\/key>\s*<string>9<\/string>/)
})
