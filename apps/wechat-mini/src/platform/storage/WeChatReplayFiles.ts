import type Taro from '@tarojs/taro'
import type { IReplayFiles } from './WeChatTrainingRepository'

/** 微信用户目录下的 JSON 文件可以跨小程序重启读取。 */
export class WeChatReplayFiles implements IReplayFiles {
  constructor(private readonly fs: Taro.FileSystemManager, private readonly userDataPath: string) {}

  read(name: string): Promise<string | null> {
    return new Promise((resolve, reject) => this.fs.readFile({
      filePath: this.path(name), encoding: 'utf8',
      success: ({ data }) => {
        if (typeof data === 'string') resolve(data)
        else reject(new Error('回放文件内容无法读取。'))
      },
      fail: (error) => {
        if (isMissing(error)) resolve(null)
        else reject(new Error('读取回放文件失败，请重试。', { cause: error }))
      },
    }))
  }

  write(name: string, data: string): Promise<void> {
    return new Promise((resolve, reject) => this.fs.writeFile({
      filePath: this.path(name), data, encoding: 'utf8', success: () => resolve(),
      fail: (error) => reject(new Error('保存回放失败，请检查本地存储空间。', { cause: error })),
    }))
  }

  remove(name: string): Promise<void> {
    return new Promise((resolve, reject) => this.fs.unlink({
      filePath: this.path(name), success: () => resolve(),
      fail: (error) => {
        if (isMissing(error)) resolve()
        else reject(new Error('删除回放文件失败，请重试。', { cause: error }))
      },
    }))
  }

  private path(name: string): string {
    return `${this.userDataPath}/${name}`
  }
}

function isMissing({ errMsg }: { errMsg: string }): boolean {
  return /no such file|file not exist|ENOENT/i.test(errMsg)
}
