// Compila el APK de Android (depuración) y lo deja en ./hipertunel.apk.
// Requisitos (una vez): brew install --cask android-commandlinetools, SDK 35 y openjdk@21.
import { execSync } from 'node:child_process';
import { copyFileSync, writeFileSync, existsSync } from 'node:fs';
const env = { ...process.env };
env.JAVA_HOME ||= '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';
env.ANDROID_HOME ||= '/opt/homebrew/share/android-commandlinetools';
const run = (c, cwd) => execSync(c, { stdio: 'inherit', env, cwd });
run('npm run build');
run('npx cap sync android');
if (!existsSync('android/local.properties')) writeFileSync('android/local.properties', 'sdk.dir=' + env.ANDROID_HOME + '\n');
run('./gradlew assembleDebug -q', 'android');
copyFileSync('android/app/build/outputs/apk/debug/app-debug.apk', 'hipertunel.apk');
console.log('APK listo: hipertunel.apk');
