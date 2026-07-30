
            let leadTargetClassId = null;
            function openAddLeadForClass() {
              if (typeof currentClassId !== 'undefined') leadTargetClassId = currentClassId;
              openAddLead();
            }
            function openImportLeadsForClass() {
              if (typeof currentClassId !== 'undefined') leadTargetClassId = currentClassId;
              openImportLeadsModal();
            }
          