// https://stackoverflow.com/questions/5670752/how-can-i-pretty-print-json-using-node-js

import { of, from } from "rxjs";
import { delay, map, switchMap, tap } from "rxjs/operators";
import * as path from 'path';
import * as fs from 'fs';
import * as util from 'util';
import * as child_process from 'child_process';
import moment from 'moment'
import * as crypto from 'crypto'

function runCmd(cmd) {
    const exec = util.promisify(child_process.exec);
    return exec(cmd);
}

function getContentByTag(tagName, content) {
    return content.split(`## ${tagName}`)[1];
}

/**
 * 取得目錄內的所有 Dockerfile path
 */
function getAllDockerFilePath(projectsPath) {
    // 驗證路徑是否存在
    const validPath = fs.existsSync(projectsPath);
    if (!validPath) {
        console.log(`路徑不存在: ${projectsPath}`);
        return;
    }
    // 所有專案資料夾名稱 
    const allProjectDirectoryName = fs.readdirSync(projectsPath);
    // 組合 Docker file path 
    const allDockerFilePath = allProjectDirectoryName.map(projectDirectoryName =>
        path.join(projectsPath, projectDirectoryName, 'Dockerfile')
    )
    return of(allDockerFilePath);
};

/**
 * 讀取目錄內的所有 Dockerfile 內容
 */
function getAllDockerFileInfo(allDockerFilePath) {
    const { promises: { readFile } } = fs;
    const readPromiseList = allDockerFilePath.map(filePath => readFile(filePath));
    return from(Promise.all(readPromiseList).then(allFileContent => {
        return allFileContent.map((content, index) => {
            const fileContent = content.toString();
            const filePath = allDockerFilePath[index];
            const [folderPath] = filePath.split('Dockerfile');
            return { fileContent, filePath, folderPath };
        });
    }));
}

/**
 * 讀取目錄內的所有 package.json 內容
 */
function getAllPackageJson(infoList) {
    const { promises: { readFile } } = fs;
    const readPackagePromiseList = infoList.map(info => readFile(`${info.folderPath}/package.json`));
    return from(Promise.all(readPackagePromiseList)).pipe(
        map(packageStringList => packageStringList.map(ps => JSON.parse(ps))),
        map(packageJsonList => {
            infoList = infoList.map((info, index) => (
                { ...info, packageJson: packageJsonList[index] }
            ));
            return infoList;
        })
    );
}

/**
 * 取得所有 os 套件
 */
function getOsPackageList(infoList) {
    const allPackge = infoList.flatMap(({ fileContent }) =>
        fileContent.split('## os package')[1].split('\n').filter(s => !!s)
    );
    const packgeList = [... new Set(allPackge)];
    return packgeList;
}

/**
 * 取得 Base image
 */
function getBaseImage(infoList) {
    const [firstInfo] = infoList;
    const { fileContent } = firstInfo;
    const baseImage = fileContent.split('\n').find(c => c.includes('FROM'));
    return baseImage;
}

function getNodeCoreDependenciesJson(infoList) {
    // 取得不重複套件 json
    const generateCoreJson = (k) => {
        const allDependencies = infoList.flatMap(({ packageJson }) => {
            const dpdsObj = packageJson[k];
            return Object.keys(dpdsObj).map(key => ({ key, value: dpdsObj[key] }));
        });
        const packgeKeyList = [... new Set(allDependencies.map(({ key }) => key))];
        return packgeKeyList.reduce((res, key) => {
            const { value } = allDependencies.find(d => d.key === key);
            res[key] = value;
            return res
        }, {});
    };
    // 回傳
    const dependencies = generateCoreJson('dependencies');
    const devDependencies = generateCoreJson('devDependencies');
    return { dependencies, devDependencies };
}

/**
 * 產出 Peng Core package json
 */
function generatePengCorePackageJson(coreFilePath, infoList) {
    const coreDependenciew = getNodeCoreDependenciesJson(infoList);
    const packageJsonTemplate = infoList[0].packageJson;
    const corePackageJson = { ...packageJsonTemplate, ...coreDependenciew };
    // 寫檔
    const { promises: { writeFile } } = fs;
    return from(writeFile(`${coreFilePath}/package.json`, JSON.stringify(corePackageJson, null, 4))).pipe(
        map(() => infoList)
    );
}


/**
 * 產出 Peng Core image
 */
function generatePengCoreImage(dockerFilePath, imageName, infoList) {
    // 取得所有 package
    const osPackageList = getOsPackageList(infoList);
    // package  套件字串
    const osPackageContent = osPackageList.reduce((res, content) => res + content + '\n', '');
    // Base image 字串
    const baseImage = getBaseImage(infoList);
    // 工作目錄
    const workdir = getContentByTag('workdir', infoList[0].fileContent);
    // 組出 Core image content 準備寫檔
    const formStr = `#${imageName}\n${baseImage}\n`;
    const workdirStr = `# workdir${workdir}`;
    const osPackageStr = `# os package\n${osPackageContent}`;
    const installPackge = `# install package\nRUN n 10.13\nCOPY ./package*.json ./\nRUN npm install`
    const coreImageContent = formStr + workdirStr + osPackageStr + installPackge;
    // 寫檔
    const { promises: { writeFile } } = fs;
    return from(writeFile(`${dockerFilePath}/Dockerfile`, coreImageContent)).pipe(
        map(() => infoList)
    );
}

/**
 * 產出 Peng App image
 */
function generatePengAppImage(CORE_IMAGE_NAME, infoList) {
    // 定義產出 app image 方法
    const getAppImageFromCore = (content => {
        const from = `FROM ${CORE_IMAGE_NAME}`
        const workdir = getContentByTag('workdir', content);
        const working = getContentByTag('working', content);
        const newContent = `${from}\n${workdir}\n${working}`;
        return newContent;
    });
    // 加入新欄位到 info list
    const newInfoList = infoList.map(info => {
        const { fileContent, folderPath, filePath } = info;
        const pengDockerFileName = 'PengDockerfile';
        const pengImagePath = folderPath + pengDockerFileName;
        const pengImageContent = getAppImageFromCore(fileContent);
        // image name
        const pathLevel = filePath.toString().split('\\');
        const projectName = pathLevel[pathLevel.length - 2];
        const pengImageName = `peng/${projectName}`;
        return { ...info, pengImagePath, pengImageContent, pengImageName, pengDockerFileName };
    });
    // 產出檔案 
    const { promises: { writeFile } } = fs;
    const promiseList = newInfoList.map(({ pengImagePath, pengImageContent }) =>
        writeFile(pengImagePath, pengImageContent)
    );
    return from(Promise.all(promiseList)).pipe(
        map(() => newInfoList)
    );
}

function getAllBuildImageBat(coreFilePath, coreImageName, infoList) {
    const coreBat = {
        name: 'peng-core',
        commandStr: `cd ${coreFilePath} & docker build -t ${coreImageName} .`,
        command: [
            `cd ${coreFilePath}`,
            `docker build -t ${coreImageName} .`
        ]
    };
    const appImageBatList = infoList.map(info => {
        const { folderPath, pengDockerFileName, pengImageName, packageJson } = info;
        return {
            name: packageJson.name,
            commandStr: `cd ${folderPath} & docker build --no-cache -t ${pengImageName} -f ${pengDockerFileName} .`,
            command: [
                `cd ${folderPath}`,
                `docker build --no-cache -t ${pengImageName} -f ${pengDockerFileName} .`
            ]
        };
    });
    return of([coreBat, ...appImageBatList]);
}

function generateBuildImageBat(savePath, batList) {
    const { promises: { writeFile } } = fs;
    const promiseList = batList.map(({ name, command }) => {
        const batContent = command.reduce((res, cmd) => `${res}\n${cmd}`, '') + '\npause';
        writeFile(`${savePath}/${name}.bat`, batContent)
    });
    return from(Promise.all(promiseList)).pipe(
        map(() => batList)
    );
}

function generateSelfKeyPair(infoList) {
    const promiseList = infoList.map(() => generateKeyPairPromise());
    return from(Promise.all(promiseList)).pipe(
        map(keyPairList => {
            return infoList.map((info, index) => {
                const selfKeyPair = keyPairList[index];
                return { ...info, selfKeyPair }
            });
        })
    );
}

function generateKeyJson(infoList) {
    const infoListOne = infoList
        .map(info => {
            const content = getContentByTag('allow access', info.fileContent);
            const allowAccessNameList = content.split('[')[1].split(']')[0].split(',');
            return { ...info, allowAccessNameList };
        });
    const infoListTwo = infoListOne
        .map(info => {
            const allowAccessPublicKey = infoListOne
                .filter(x => x.allowAccessNameList.some(name => name === info.packageJson.name))
                .map(x => {
                    const name = x.packageJson.name;
                    const publicKey = x.selfKeyPair.publicKey;
                    return { name, publicKey };
                });
            const keyJsonPath = `${info.folderPath}/key.json`;
            return { ...info, allowAccessPublicKey, keyJsonPath };
        });
    const promiseList = infoListTwo.map(info => {
        const { selfKeyPair, allowAccessPublicKey, keyJsonPath } = info;
        const keyJson = { selfKeyPair, allowAccessPublicKey };
        const { promises: { writeFile } } = fs;
        return writeFile(keyJsonPath, JSON.stringify(keyJson, null, 4))
    });
    return from(Promise.all(promiseList)).pipe(
        map(() => infoListTwo)
    );
}

function generateKeyPairPromise() {
    return new Promise((resolve, reject) => {
      crypto.generateKeyPair('rsa', {
        modulusLength: 1024,
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem',
        },
        privateKeyEncoding: {
          type: 'pkcs8',
          format: 'pem'
        }
      }, (err, publicKey, privateKey) => {
        const keyPair = {publicKey, privateKey}
        err !== null ? reject(err) : resolve(keyPair);
      });
    });
  }



/**
 * 論文方法
 */
function PENG() {
    // const PROJECTS_PATH = process.cwd() + '/angular';
    const PROJECTS_PATH = process.cwd() + '/projects';
    const CORE_FILE_PATH = process.cwd() + '/core';
    const CORE_IMAGE_NAME = 'peng/core';
    const BUILD_IMAGE_BAT_PATH = 'build-image-bat';
    of(PROJECTS_PATH).pipe(
        switchMap(projectsPath => getAllDockerFilePath(projectsPath)),
        switchMap(allFilePath => getAllDockerFileInfo(allFilePath)),
        switchMap(infoList => getAllPackageJson(infoList)),
        switchMap(infoList => generatePengCoreImage(CORE_FILE_PATH, CORE_IMAGE_NAME, infoList)),
        switchMap(infoList => generatePengCorePackageJson(CORE_FILE_PATH, infoList)),
        switchMap(infoList => generatePengAppImage(CORE_IMAGE_NAME, infoList)),
        switchMap(infoList => generateSelfKeyPair(infoList)),
        switchMap(infoList => generateKeyJson(infoList)),
        switchMap(infoList => getAllBuildImageBat(CORE_FILE_PATH, CORE_IMAGE_NAME, infoList)),
        switchMap(batList => generateBuildImageBat(BUILD_IMAGE_BAT_PATH, batList)),
    ).subscribe(res => {
        console.log(res);
    });
}

PENG();
// from(Promise.all([generateKeyPairPromise(), generateKeyPairPromise()])).subscribe(res => console.log(res));
// from([of(1).pipe(delay(100000)),of(1),of(1),of(1),of(1)]).subscribe(res => {
//     console.log(res);
// });


// runCmd('docker image ls').then((res, err) => console.log(res, err));

//node - build 出所有 image