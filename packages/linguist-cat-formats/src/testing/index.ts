/**
 * Testing utilities for @linguist/cat-formats: the generic round-trip
 * harness (plan §6.3) plus the FakeAdapter fixtures that prove it.
 * Nothing here is registered in any production registry by default.
 */

export {
  assertRoundTrip,
  type RoundTripInvariant,
  type RoundTripOptions,
  type RoundTripReport,
} from './harness'

export { BadSegmentDropAdapter, encodeFakeTsv, FAKE_ADAPTER_ID, FakeAdapter } from './fake-adapter'
