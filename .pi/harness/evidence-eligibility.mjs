export const EVIDENCE_STATES=Object.freeze(["RECORDED","INTEGRITY_VERIFIED","PROTOCOL_EVALUABLE","OUTCOME_RECORDED","RESEARCHER_ACCEPTED"]);
export function assessEvidenceEligibility({integrityVerified=false,terminalStatus,protocolBinding=false,outcomeRecorded=false,researcherAccepted=false}={}){
	let state="RECORDED";
	if(integrityVerified) state="INTEGRITY_VERIFIED";
	if(integrityVerified&&terminalStatus==="COMPLETED"&&protocolBinding) state="PROTOCOL_EVALUABLE";
	if(state==="PROTOCOL_EVALUABLE"&&outcomeRecorded) state="OUTCOME_RECORDED";
	if(state==="OUTCOME_RECORDED"&&researcherAccepted) state="RESEARCHER_ACCEPTED";
	return Object.freeze({contractVersion:2,state,claimEligible:state==="RESEARCHER_ACCEPTED",terminalStatus:terminalStatus??"UNKNOWN"});
}
