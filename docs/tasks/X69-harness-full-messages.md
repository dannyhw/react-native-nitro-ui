# X69 — a failed harness comparison prints the values in full

**Kind:** tooling · **Devices:** ios, android · **Budget:** 1.5 h for round one (X67)

## Goal

A red harness test's message names every element of the arrays it compared, so a CI log
answers what arrived without a rerun.

## Why

On a hosted runner `ListItem · G30` failed with `expected [ Array(2) ] to deeply equal
[ 'form-item:press' ]`: chai cuts a value at 40 characters, so the two event names that
decided the failure were not in the log.

## Behaviour

1. A harness failure message prints arrays and objects in full on both platforms.
2. No assertion changes.

## Proof

- A harness test that fails an array comparison on purpose and reads its message, passing
  with `harness:ios -- HarnessMessages` and `harness:android -- HarnessMessages`, and red on
  both with the setup file's line removed.

## Out of scope

The ListItem G30 failure itself, and the jest-side reporter on the host.
