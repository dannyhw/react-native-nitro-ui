/**
 * Runs in the app before each harness test file.
 *
 * Chai cuts a value in a failure message at 40 characters, so a failed array comparison
 * prints `[ Array(2) ]` and hides which elements arrived. Off, the message names them.
 */
import { config } from 'chai';

config.truncateThreshold = 0;
