import type { Airline, Passenger } from "../domain/passenger.js";

export interface CheckInOutcome {
  /** Path of the saved boarding pass; empty when the airline only emails it. */
  boardingPass: string;
  alreadyCheckedIn: boolean;
}

export interface AirlineAdapter {
  readonly airline: Airline;
  checkIn(passenger: Passenger): Promise<CheckInOutcome>;
  close(): Promise<void>;
}

export interface AdapterProvider {
  get(airline: Airline): Promise<AirlineAdapter>;
  closeAll(): Promise<void>;
}
