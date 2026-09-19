import { Injectable } from '@nestjs/common';
import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const runArgon2 = promisify(argon2);
const algorithm = 'argon2id';
const memory = 65_536;
const passes = 3;
const parallelism = 1;
const tagLength = 32;

@Injectable()
export class PasswordService {
  public async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const hash = await runArgon2(algorithm, {
      message: Buffer.from(password),
      nonce: salt,
      memory,
      passes,
      parallelism,
      tagLength
    });

    return [algorithm, `m=${memory},t=${passes},p=${parallelism}`, salt.toString('base64url'), hash.toString('base64url')].join('$');
  }

  public async verify(password: string, encoded: string): Promise<boolean> {
    const [storedAlgorithm, parameters, encodedSalt, encodedHash] = encoded.split('$');
    if (storedAlgorithm !== algorithm || !parameters || !encodedSalt || !encodedHash) {
      return false;
    }

    const parameterMatch = /^m=(\d+),t=(\d+),p=(\d+)$/.exec(parameters);
    const storedMemory = Number(parameterMatch?.[1]);
    const storedPasses = Number(parameterMatch?.[2]);
    const storedParallelism = Number(parameterMatch?.[3]);
    const salt = Buffer.from(encodedSalt, 'base64url');
    const expected = Buffer.from(encodedHash, 'base64url');

    if (!Number.isSafeInteger(storedMemory) || !Number.isSafeInteger(storedPasses) || !Number.isSafeInteger(storedParallelism) || salt.length < 16 || expected.length !== tagLength) {
      return false;
    }

    const actual = await runArgon2(algorithm, {
      message: Buffer.from(password),
      nonce: salt,
      memory: storedMemory,
      passes: storedPasses,
      parallelism: storedParallelism,
      tagLength: expected.length
    });
    return timingSafeEqual(actual, expected);
  }
}
